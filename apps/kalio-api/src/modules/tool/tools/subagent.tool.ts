import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { SubagentToolResult, ToolCallRequest, ToolMeta, VFSMode } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { TOOL_CATALOG, type ToolCatalogPort } from '../tool-catalog.port';
import { SUBAGENT_RUNTIME, type SubagentRuntimePort } from '../subagent-runtime.port';
import { PersonaService } from '../../persona/persona.service';
import { CredentialsService } from '../../credentials/credentials.service';

function buildDelegatedRequest(
  request: ToolCallRequest,
  args: Record<string, unknown>,
): ToolCallRequest {
  return {
    ...request,
    toolName: 'run_subagent',
    args,
  };
}

@Injectable()
@Tool({
  name: 'run_subagent',
  description:
    'Spawn a focused sub-agent to complete a specific task using LLM reasoning. ' +
    'Best for self-contained tasks: summarisation, analysis, drafting content, answering questions. ' +
    'Returns the sub-agent result as text.',
  parameters: {
    type: 'object',
    required: ['inputPrompt'],
    properties: {
      inputPrompt: {
        type: 'string',
        description: 'Clear task prompt for the sub-agent. This is the only required input.',
      },
      objective: {
        type: 'string',
        description: 'Deprecated alias for inputPrompt. Use inputPrompt instead.',
      },
      childSessionId: {
        type: 'string',
        description: 'Optional existing sub-agent session id. When provided, send the objective as the next user message into that chat instead of creating a new one.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Max execution time in milliseconds. Default: 300000 (5 min). Max: 600000 (10 min).',
      },
      personaId: {
        type: 'string',
        description: 'Persona used by the sub-agent. Allowed tools are resolved from this persona. Defaults to default.',
      },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of parent VFS paths to copy into the child VFS (isolated mode) before execution.',
      },
      vfsMode: {
        type: 'string',
        enum: ['isolated', 'shared'],
        description: 'VFS mode for the sub-agent. isolated = private child VFS copied back on completion; shared = child reads and writes the parent VFS directly. Use shared when the child must inspect or modify files already present in the parent VFS or produced by earlier child agents.',
      },
      copyOutputs: {
        type: 'boolean',
        description: 'When true, copy isolated child VFS files back into the master VFS. Default: true.',
      },
    },
  },
})
export class SubagentTool {
  private readonly logger = new Logger(SubagentTool.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(TOOL_CATALOG) private readonly toolCatalog: ToolCatalogPort,
    private readonly personaService: PersonaService,
    private readonly credentialsService: CredentialsService,
  ) {}

  private getRuntime(): SubagentRuntimePort {
    try {
      const candidate = this.moduleRef.get(SUBAGENT_RUNTIME, { strict: false }) as unknown;
      if (this.isRuntime(candidate)) return candidate;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.debug(`[run_subagent] Runtime unavailable: ${error.message}`);
    }
    throw new Error('Subagent runtime is unavailable');
  }

  private isRuntime(value: unknown): value is SubagentRuntimePort {
    return typeof value === 'object'
      && value !== null
      && 'runSubagent' in value
      && typeof (value as { runSubagent?: unknown }).runSubagent === 'function';
  }

  private async getPersonaTools(personaId: string): Promise<ToolMeta[]> {
    const personaConfig = await this.personaService.getSessionConfig(personaId);
    if (!personaConfig) {
      throw new Error(`Persona ${personaId} not found`);
    }

    const allowedTools = personaConfig.allowedTools ?? [];

    if (allowedTools.length === 0) return [];

    if (typeof this.toolCatalog.getToolsForSkills === 'function') {
      return this.toolCatalog.getToolsForSkills(allowedTools);
    }

    if (typeof this.toolCatalog.getEntries === 'function') {
      const allowed = new Set(allowedTools);
      return this.toolCatalog
        .getEntries()
        .map((entry) => entry.meta)
        .filter((meta) => allowed.has(meta.name));
    }

    if (typeof this.toolCatalog.getAllTools === 'function') {
      const allowed = new Set(allowedTools);
      return this.toolCatalog.getAllTools().filter((meta) => allowed.has(meta.name));
    }

    throw new Error('Tool catalog does not expose a supported tool listing API');
  }

  async execute(request: ToolCallRequest): Promise<SubagentToolResult> {
    const inputPrompt = request.args['inputPrompt'];
    const deprecatedObjective = request.args['objective'];
    const objective = typeof inputPrompt === 'string' && inputPrompt.trim().length > 0
      ? inputPrompt
      : (typeof deprecatedObjective === 'string' ? deprecatedObjective : '');
    if (!objective) {
      throw new Error('run_subagent requires inputPrompt');
    }
    const childSessionId = typeof request.args['childSessionId'] === 'string'
      ? request.args['childSessionId']
      : undefined;
    const rawTimeout = request.args['timeoutMs'] as number | undefined;
    const personaId = typeof request.args['personaId'] === 'string' && request.args['personaId'].trim().length > 0
      ? request.args['personaId'] as string
      : 'default';
    const attachments = Array.isArray(request.args['attachments'])
      ? (request.args['attachments'] as unknown[]).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : undefined;
    const rawVfsMode = request.args['vfsMode'];
    const vfsMode: VFSMode = rawVfsMode === 'shared' ? 'shared' : 'isolated';
    const copyOutputs = request.args['copyOutputs'] !== false;
    const timeoutMs = Math.min(rawTimeout ?? 300_000, 600_000);
    const taskId = randomUUID();
    const sessionId = request.sessionId;
    this.logger.log(`[run_subagent] Starting task ${taskId}: ${objective.slice(0, 80)}`);

    const tools = await this.getPersonaTools(personaId);
    const maxIterations = await this.credentialsService.getMaxToolAttempts();
    const runtime = this.getRuntime();
    return runtime.runSubagent({
      parentSessionId: sessionId,
      parentToolCallId: request.callId,
      objective,
      attachments,
      childSessionId,
      personaId,
      availableTools: tools,
      timeoutMs,
      maxIterations,
      vfsMode,
      copyOutputs,
      emit: request._emit,
      parentAgentRun: request.agentRun,
    });
  }
}

@Injectable()
@Tool({
  name: 'spawn_subagent',
  description:
    'Spawn a new focused sub-agent chat for a specific task. ' +
    'Use this when you want an explicit new child session rather than continuing an existing one.',
  parameters: {
    type: 'object',
    required: ['inputPrompt'],
    properties: {
      inputPrompt: {
        type: 'string',
        description: 'Clear task prompt for the new sub-agent.',
      },
      objective: {
        type: 'string',
        description: 'Deprecated alias for inputPrompt. Use inputPrompt instead.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Max execution time in milliseconds. Default: 300000 (5 min). Max: 600000 (10 min).',
      },
      personaId: {
        type: 'string',
        description: 'Persona used by the sub-agent. Allowed tools are resolved from this persona.',
      },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional parent VFS paths copied into the child VFS before execution.',
      },
      vfsMode: {
        type: 'string',
        enum: ['isolated', 'shared'],
        description: 'VFS mode for the sub-agent. isolated = private child VFS copied back on completion; shared = child reads and writes the parent VFS directly. Use shared when the child must inspect or modify files already present in the parent VFS or produced by earlier child agents.',
      },
      copyOutputs: {
        type: 'boolean',
        description: 'When true, copy isolated child VFS files back into the master VFS. Default: true.',
      },
    },
  },
})
export class SpawnSubagentTool {
  constructor(private readonly subagentTool: SubagentTool) {}

  async execute(request: ToolCallRequest): Promise<SubagentToolResult> {
    const { childSessionId: _ignored, ...restArgs } = request.args;
    return this.subagentTool.execute(buildDelegatedRequest(request, restArgs));
  }
}

@Injectable()
@Tool({
  name: 'message_subagent',
  description:
    'Send the next message into an existing focused sub-agent chat. ' +
    'Use this when you already have a childSessionId and want that same child to continue.',
  parameters: {
    type: 'object',
    required: ['inputPrompt', 'childSessionId'],
    properties: {
      inputPrompt: {
        type: 'string',
        description: 'Follow-up prompt for the existing sub-agent chat.',
      },
      objective: {
        type: 'string',
        description: 'Deprecated alias for inputPrompt. Use inputPrompt instead.',
      },
      childSessionId: {
        type: 'string',
        description: 'Existing sub-agent session id to continue.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Max execution time in milliseconds. Default: 300000 (5 min). Max: 600000 (10 min).',
      },
      personaId: {
        type: 'string',
        description: 'Optional persona override for the continued sub-agent turn.',
      },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional parent VFS paths copied into the child VFS before execution.',
      },
      vfsMode: {
        type: 'string',
        enum: ['isolated', 'shared'],
        description: 'VFS mode for the sub-agent. isolated = private child VFS copied back on completion; shared = child reads and writes the parent VFS directly. Use shared when the child must inspect or modify files already present in the parent VFS or produced by earlier child agents.',
      },
      copyOutputs: {
        type: 'boolean',
        description: 'When true, copy isolated child VFS files back into the master VFS. Default: true.',
      },
    },
  },
})
export class MessageSubagentTool {
  constructor(private readonly subagentTool: SubagentTool) {}

  async execute(request: ToolCallRequest): Promise<SubagentToolResult> {
    const childSessionId = typeof request.args['childSessionId'] === 'string'
      ? request.args['childSessionId'].trim()
      : '';

    if (!childSessionId) {
      throw new Error('message_subagent requires childSessionId');
    }

    return this.subagentTool.execute(buildDelegatedRequest(request, {
      ...request.args,
      childSessionId,
    }));
  }
}
