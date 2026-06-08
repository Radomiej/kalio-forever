import { vi } from 'vitest';
import type { PersonaService } from '../../persona/persona.service';
import type { SkillsService } from '../../skills/skills.service';
import { ContextAssemblyService } from '../context-assembly.service';
import { ToolPolicyService } from '../tool-policy.service';
import { LLMTurnRuntimeService } from '../llm-turn-runtime.service';
import { SubagentRuntimeService } from '../subagent-runtime.service';
import { ChatService } from '../chat.service';
import type { AuditService } from '../audit.service';
import type { CredentialsService } from '../../credentials/credentials.service';
import type { ILLMSource } from '../interfaces/llm-source.interface';
import type { SessionManagerService } from '../session-manager.service';
import type { SessionsService } from '../sessions.service';
import type { StreamProcessorService } from '../stream-processor.service';
import type { ToolDispatchService } from '../tool-dispatch.service';
import type { VFSService } from '../../vfs/vfs.service';

export function makeToolPolicy(
  personaService: Partial<PersonaService>,
  toolDispatch: Pick<ToolDispatchService, 'getToolMetas'>,
): ToolPolicyService {
  return new ToolPolicyService(
    personaService as PersonaService,
    toolDispatch as unknown as ToolDispatchService,
  );
}

export function makeContextAssembly(
  personaService: Partial<PersonaService>,
  toolDispatch: Pick<ToolDispatchService, 'getToolMetas'>,
  skills: SkillsService = { findByIds: vi.fn().mockResolvedValue([]) } as unknown as SkillsService,
): ContextAssemblyService {
  return new ContextAssemblyService(
    personaService as PersonaService,
    skills,
    makeToolPolicy(personaService, toolDispatch),
  );
}

export function makeLLMTurnRuntime(
  llmSource: ILLMSource,
  streamProcessor: Pick<StreamProcessorService, 'process'>,
  sessionManager: Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>,
  toolDispatch: Pick<ToolDispatchService, 'dispatch'>,
  audit?: Partial<AuditService>,
): LLMTurnRuntimeService {
  return new LLMTurnRuntimeService(
    llmSource,
    streamProcessor as unknown as StreamProcessorService,
    sessionManager as unknown as SessionManagerService,
    toolDispatch as unknown as ToolDispatchService,
    audit as AuditService,
  );
}

export function makeChatService(params: {
  llmSource: ILLMSource;
  streamProcessor: Pick<StreamProcessorService, 'process'>;
  sessionManager: SessionManagerService;
  toolDispatch: ToolDispatchService;
  personaService: Partial<PersonaService>;
  credentialsService: Pick<CredentialsService, 'getMaxToolAttempts'>;
  auditService?: Partial<AuditService>;
  skillsService?: SkillsService;
}): ChatService {
  const contextAssembly = makeContextAssembly(params.personaService, params.toolDispatch, params.skillsService);
  const llmTurnRuntime = makeLLMTurnRuntime(
    params.llmSource,
    params.streamProcessor,
    params.sessionManager,
    params.toolDispatch,
    params.auditService,
  );
  return new ChatService(
    params.sessionManager,
    params.credentialsService as CredentialsService,
    params.auditService as AuditService,
    llmTurnRuntime,
    undefined,
    contextAssembly,
  );
}

export function makeSubagentRuntime(params: {
  llmSource: ILLMSource;
  streamProcessor: Pick<StreamProcessorService, 'process'>;
  toolDispatch: ToolDispatchService;
  sessionManager: SessionManagerService;
  sessions: SessionsService;
  vfs: VFSService;
  personaService?: Partial<PersonaService>;
  audit?: Partial<AuditService>;
  skillsService?: SkillsService;
}): SubagentRuntimeService {
  const personaService = params.personaService ?? {
    getSessionConfig: vi.fn().mockResolvedValue({
      systemPrompt: '',
      model: '',
      allowedTools: [],
      skillIds: [],
      mcpPolicy: 'deny_all',
      kv: {},
    }),
  };
  const toolPolicy = makeToolPolicy(personaService, params.toolDispatch);
  const contextAssembly = makeContextAssembly(personaService, params.toolDispatch, params.skillsService);
  const llmTurnRuntime = makeLLMTurnRuntime(
    params.llmSource,
    params.streamProcessor,
    params.sessionManager,
    params.toolDispatch,
    params.audit,
  );
  return new SubagentRuntimeService(
    params.llmSource,
    llmTurnRuntime,
    params.sessionManager,
    params.sessions,
    params.vfs,
    contextAssembly,
    toolPolicy,
    params.audit as AuditService,
  );
}
