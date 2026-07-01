import { describe, expect, it, vi } from 'vitest';
import type { AgentRunContext, ChatSession, ToolMeta, ToolResult } from '@kalio/types';
import { SubagentRuntimeService } from '../subagent-runtime.service';
import { TurnState } from '../turn-state';
import type { ILLMSource, LLMSourceParams } from '../interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { StreamProcessorService } from '../stream-processor.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import type { SessionManagerService } from '../session-manager.service';
import type { SessionsService } from '../sessions.service';
import type { VFSService } from '../../vfs/vfs.service';
import type { PersonaService } from '../../persona/persona.service';
import { RunCliAgentTool } from '../../tool/tools/run-cli-agent.tool';
import type { RunCliAgentRequest } from '../../cli-agent/cli-agent.types';
import { parseRawXmlToolCall } from '../raw-tool-call.parser';
import { makeSubagentRuntime } from './llm-runtime-test-harness';
import type { AuditService } from '../audit.service';
import type { SkillsService } from '../../skills/skills.service';

const tools: ToolMeta[] = [
  { name: 'run_subagent', description: 'spawn child', parameters: {}, requiresConfirmation: false },
  { name: 'run_cli_agent', description: 'run CLI child', parameters: {}, requiresConfirmation: true },
  { name: 'vfs_read', description: 'read file', parameters: {}, requiresConfirmation: false },
  { name: 'vfs_write', description: 'write file', parameters: {}, requiresConfirmation: true },
];

async function* streamFrom(chunks: InternalLLMChunk[]): AsyncIterable<InternalLLMChunk> {
  for (const chunk of chunks) yield chunk;
}

async function* throwingStream(error: Error): AsyncIterable<InternalLLMChunk> {
  throw error;
}

function neverStream(): AsyncIterable<InternalLLMChunk> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<InternalLLMChunk> {
      return {
        next: () => new Promise<IteratorResult<InternalLLMChunk>>(() => undefined),
      };
    },
  };
}

function makeProcessor(sessionManager: Pick<SessionManagerService, 'persistAssistantMessage'>): Pick<StreamProcessorService, 'process'> {
  return {
    process: vi.fn(async (chunk: InternalLLMChunk, ctx: StreamContext) => {
      if (chunk.type === 'text_delta') {
        ctx.state.appendText(chunk.delta);
        ctx.emit('chat:chunk', { sessionId: ctx.sessionId, messageId: ctx.messageId, delta: chunk.delta, done: false, agentRun: ctx.agentRun });
      }
      if (chunk.type === 'tool_call') {
        ctx.state.addToolCall({ id: chunk.callId, name: chunk.name, args: chunk.args });
      }
      if (chunk.type === 'done') {
        if (ctx.state.toolCalls.length === 0) {
          const parsedToolCall = parseRawXmlToolCall(ctx.state.text, ctx.rawXmlToolNames);
          if (parsedToolCall) {
            ctx.state.addToolCall(parsedToolCall);
            ctx.state.replaceText('');
          }
        }
        await sessionManager.persistAssistantMessage(ctx.sessionId, ctx.messageId, ctx.state as TurnState);
      }
    }),
  };
}

function makeSession(id: string, parentSessionId?: string): ChatSession {
  return {
    id,
    personaId: 'default',
    title: `Sub-agent: ${id}`,
    kind: 'subagent',
    parentSessionId,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildSubagentRuntime(
  llmSource: ILLMSource,
  streamProcessor: Pick<StreamProcessorService, 'process'>,
  toolDispatch: ToolDispatchService,
  sessionManager: SessionManagerService,
  sessions: SessionsService,
  vfs: VFSService,
  personaService?: PersonaService,
  audit?: AuditService,
  skillsService?: SkillsService,
): SubagentRuntimeService {
  return makeSubagentRuntime({
    llmSource,
    streamProcessor,
    toolDispatch,
    sessionManager,
    sessions,
    vfs,
    personaService,
    audit,
    skillsService,
  });
}

describe('SubagentRuntimeService nested subagents', () => {
  it('uses streamed chunks as the final result when the turn state text accumulator is empty', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'text_delta', delta: 'streamed fallback result' },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const processor = {
      process: vi.fn(async (chunk: InternalLLMChunk, ctx: StreamContext) => {
        if (chunk.type === 'text_delta') {
          ctx.emit('chat:chunk', {
            sessionId: ctx.sessionId,
            messageId: ctx.messageId,
            delta: chunk.delta,
            done: false,
            agentRun: ctx.agentRun,
          });
        }
        if (chunk.type === 'done') {
          await sessionManager.persistAssistantMessage(ctx.sessionId, ctx.messageId, ctx.state as TurnState);
        }
      }),
    };
    const runtime = buildSubagentRuntime(
      llmSource,
      processor as unknown as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', allowedTools: [], skillIds: [], mcpPolicy: 'deny_all', kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-stream-fallback',
      objective: 'return streamed text',
      availableTools: tools,
      timeoutMs: 1000,
      vfsMode: 'isolated',
      copyOutputs: false,
      emit: vi.fn(),
    });

    expect(result.result).toBe('streamed fallback result');
    expect(sessionManager.loadHistoryForLLM).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        systemPrompt: expect.stringContaining('- vfs_write: write file Requires approval.'),
      }),
    );
  });

  it('passes structured output contract into the child turn and returns provider structured output', async () => {
    const structuredOutput = {
      name: 'architecture_final_artifact',
      schema: { type: 'object', properties: { status: { enum: ['accepted', 'blocked'] } }, required: ['status'] },
      strict: true,
    };
    const outputValue = {
      status: 'blocked',
      blockingReason: 'Missing verification evidence.',
      evidence: [],
      answer: 'Final typed answer.',
    };
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'structured_output', value: outputValue } as unknown as InternalLLMChunk,
        { type: 'done' },
      ])),
      getConfig: vi.fn().mockResolvedValue({ provider: 'mock', model: 'mock', apiKey: '', baseUrl: '', source: 'env' }),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue({ id: 'prompt-1' }),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as unknown as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn(() => []) } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', allowedTools: [], skillIds: [], mcpPolicy: 'deny_all', kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-structured',
      objective: 'produce a typed final artifact contract',
      structuredOutput,
      availableTools: [],
      timeoutMs: 1000,
      vfsMode: 'isolated',
      copyOutputs: false,
      emit: vi.fn(),
    });

    expect(result.structuredOutput).toEqual(outputValue);
    expect(result.result).toBe('Final typed answer.');
    expect(llmSource.stream).toHaveBeenCalledWith(expect.objectContaining({ structuredOutput }));
  });

  it('tells no-tool subagents to return plain text instead of raw tool-call markup', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'text_delta', delta: 'plain final answer' },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as unknown as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', allowedTools: [], skillIds: [], mcpPolicy: 'deny_all', kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-no-tools',
      objective: 'summarize incoming evidence',
      availableTools: [],
      timeoutMs: 1000,
      vfsMode: 'isolated',
      copyOutputs: false,
      emit: vi.fn(),
    });

    expect(result.result).toBe('plain final answer');
    expect(sessionManager.loadHistoryForLLM).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        systemPrompt: expect.stringContaining('No tools are available in this run'),
      }),
    );
    expect(sessionManager.loadHistoryForLLM).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Do not emit XML tool calls'),
      }),
    );
  });

  it('injects persona skills into subagent system prompts', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'text_delta', delta: 'used the active skill' },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as unknown as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: 'Persona base.', model: '', allowedTools: [], skillIds: ['skill-1'], mcpPolicy: 'deny_all', kv: {} }) } as unknown as PersonaService,
      undefined,
      { findByIds: vi.fn().mockResolvedValue([{ id: 'skill-1', name: 'Architecture Discipline', description: 'Use when running agent graphs.', prompt: 'Keep a delegation ledger.' }]) } as never,
    );

    await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-skills',
      objective: 'use skill',
      availableTools: [],
      timeoutMs: 1000,
      vfsMode: 'isolated',
      copyOutputs: false,
      emit: vi.fn(),
    });

    expect(sessionManager.loadHistoryForLLM).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        systemPrompt: expect.stringContaining('## Active skills'),
      }),
    );
    expect(sessionManager.loadHistoryForLLM).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Keep a delegation ledger.'),
      }),
    );
  });

  it('rejects after timeoutMs and closes the child agent turn with chat:error', async () => {
    vi.useFakeTimers();

    try {
      const llmSource: ILLMSource = {
        stream: vi.fn(() => neverStream()),
      };
      const sessionManager = {
        persistUserMessage: vi.fn().mockResolvedValue(undefined),
        persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
        saveToolResult: vi.fn().mockResolvedValue(undefined),
        loadHistory: vi.fn().mockResolvedValue([]),
        loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
      } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
      const emit = vi.fn();
      const audit = { log: vi.fn().mockResolvedValue('audit-id'), update: vi.fn().mockResolvedValue(undefined) };
      const runtime = buildSubagentRuntime(
        llmSource,
        makeProcessor(sessionManager) as StreamProcessorService,
        { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
        sessionManager as unknown as SessionManagerService,
        { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
        { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
        { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
        audit as never,
      );

      const runPromise = runtime.runSubagent({
        parentSessionId: 'master',
        parentToolCallId: 'call-timeout',
        objective: 'hang forever',
        availableTools: tools,
        timeoutMs: 50,
        vfsMode: 'isolated',
        copyOutputs: false,
        emit,
      });

      const observation: {
        value:
          | { status: 'pending' }
          | { status: 'resolved' }
          | { status: 'rejected'; error: unknown };
      } = { value: { status: 'pending' } };
      void runPromise.then(
        () => {
          observation.value = { status: 'resolved' };
        },
        (error: unknown) => {
          observation.value = { status: 'rejected', error };
        },
      );

      await vi.advanceTimersByTimeAsync(51);
      await Promise.resolve();

      const settled = observation.value;
      expect(settled.status).toBe('rejected');
      if (settled.status !== 'rejected') {
        throw new Error(`Expected timeout rejection, got ${settled.status}`);
      }
      expect(settled.error).toBeInstanceOf(Error);
      expect((settled.error as Error).message).toBe('Sub-agent timed out after 50ms');

      const startCall = emit.mock.calls.find((call: unknown[]) => call[0] === 'agent:start');
      const childSessionId = (startCall?.[1] as { sessionId: string } | undefined)?.sessionId;
      expect(childSessionId).toBeTruthy();
      expect(emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
        sessionId: childSessionId,
        code: 'LLM_TIMEOUT',
        message: 'Sub-agent timed out after 50ms',
        hadContent: false,
      }));
      expect(sessionManager.persistAssistantMessage).toHaveBeenCalledTimes(1);
      expect((sessionManager.persistAssistantMessage.mock.calls.at(-1)?.[2] as TurnState).text).toBe(
        'Sub-agent failed: Sub-agent timed out after 50ms.',
      );
      expect(emit).toHaveBeenCalledWith('agent:done', expect.objectContaining({ sessionId: childSessionId }));
      expect(emit.mock.calls.some((call: unknown[]) => call[0] === 'chat:complete')).toBe(false);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: childSessionId,
        type: 'error',
        label: 'subagent:error',
        data: expect.objectContaining({
          kind: 'subagent_error',
          childSessionId,
          parentSessionId: 'master',
          parentToolCallId: 'call-timeout',
          errorCode: 'SUBAGENT_TIMEOUT',
          failure: expect.objectContaining({
            code: 'SUBAGENT_TIMEOUT',
            source: 'subagent-runtime',
            retryable: false,
            message: 'Sub-agent timed out after 50ms',
          }),
          errorMessage: 'Sub-agent timed out after 50ms',
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses an existing child session so the parent can send another message into the same subagent chat', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([{ type: 'text_delta', delta: 'follow-up done' }, { type: 'done' }])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const existingChild = {
      id: 'sub-existing',
      personaId: 'default',
      title: 'Sub-agent: existing',
      kind: 'subagent' as const,
      parentSessionId: 'master',
      createdAt: 1,
      updatedAt: 1,
    };
    const sessions = {
      createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)),
      get: vi.fn(async () => existingChild),
      updateRuntimeContext: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      sessions as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-follow-up',
      objective: 'Refine the existing page',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
      childSessionId: 'sub-existing',
    } as Parameters<SubagentRuntimeService['runSubagent']>[0]);

    expect(sessions.get).toHaveBeenCalledWith('sub-existing');
    expect(sessions.updateRuntimeContext).toHaveBeenCalledWith(
      'sub-existing',
      expect.objectContaining({
        runtimeKind: 'subagent',
        parentSessionId: 'master',
        parentToolCallId: 'call-follow-up',
      }),
      { registerRuntimeProjectPath: true },
    );
    expect(sessions.createWithId).not.toHaveBeenCalled();
    expect(sessionManager.persistUserMessage).toHaveBeenCalledWith(
      'sub-existing',
      'Refine the existing page',
      undefined,
      expect.objectContaining({ turnId: expect.any(String) }),
    );
    expect(result.childSessionId).toBe('sub-existing');
    expect(result.result).toBe('follow-up done');
  });

  it('persists runtimeContext for a pre-created child session that has none yet', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([{ type: 'text_delta', delta: 'branch done' }, { type: 'done' }])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const existingChild = {
      id: 'branch-implementer',
      personaId: 'implementer',
      title: 'Sub-agent: implementer',
      kind: 'subagent' as const,
      parentSessionId: 'arch-root',
      runtimeContext: undefined,
      createdAt: 1,
      updatedAt: 1,
    };
    const sessions = {
      createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)),
      get: vi.fn(async () => existingChild),
      updateRuntimeContext: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      sessions as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    await runtime.runSubagent({
      parentSessionId: 'arch-root',
      parentToolCallId: 'architecture:run-1:implementer',
      childSessionId: 'branch-implementer',
      personaId: 'implementer',
      objective: 'Implement the branch task',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'shared',
      copyOutputs: false,
      auditContext: {
        architectureRunId: 'run-1',
        schemaId: 'goal-master-delivery-loop',
        schemaName: 'Goal Master Delivery Loop',
        roleSlotId: 'implementer',
        roleSlotType: 'tool_executor',
        roleLabel: 'Implementer',
        nodeId: 'node-1',
      },
      slotPolicy: {
        allowedToolNames: ['vfs_read'],
      },
      architectureContext: {
        architectureRunId: 'run-1',
        roleSlotId: 'implementer',
        hostSessionId: 'host-chat',
        historySessionId: 'host-chat',
        projectPath: 'C:\\Projekty\\kalio-forever',
      },
    });

    expect(sessions.updateRuntimeContext).toHaveBeenCalledWith(
      'branch-implementer',
      expect.objectContaining({
        runtimeKind: 'agent-flow-branch',
        parentSessionId: 'arch-root',
        parentToolCallId: 'architecture:run-1:implementer',
        architectureSlotId: 'implementer',
        architectureContext: expect.objectContaining({
          architectureRunId: 'run-1',
          schemaName: 'Goal Master Delivery Loop',
          roleSlotId: 'implementer',
          roleSlotType: 'tool_executor',
          hostSessionId: 'host-chat',
          historySessionId: 'host-chat',
          sessionSurface: 'conversation-branch',
          conversationVisibility: 'visible',
          projectPath: 'C:\\Projekty\\kalio-forever',
        }),
      }),
      { registerRuntimeProjectPath: true },
    );
    expect(sessionManager.loadHistoryForLLM).toHaveBeenCalledWith(
      'branch-implementer',
      expect.objectContaining({
        historySessionId: 'host-chat',
      }),
    );
  });

  it('keeps technical architecture router sessions visible when execution updates runtimeContext', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([{ type: 'text_delta', delta: 'router done' }, { type: 'done' }])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const existingChild = {
      id: 'arch-run-1-router',
      personaId: 'orchestrator',
      title: 'Strategic Decision Council: Router',
      kind: 'subagent' as const,
      parentSessionId: 'arch-root',
      runtimeContext: undefined,
      createdAt: 1,
      updatedAt: 1,
    };
    const sessions = {
      createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)),
      get: vi.fn(async () => existingChild),
      updateRuntimeContext: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      sessions as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    await runtime.runSubagent({
      parentSessionId: 'arch-root',
      parentToolCallId: 'architecture:run-1:router',
      childSessionId: 'arch-run-1-router',
      personaId: 'orchestrator',
      objective: 'Merge router outputs',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'shared',
      copyOutputs: false,
      auditContext: {
        architectureRunId: 'run-1',
        schemaId: 'strategic-decision-council',
        schemaName: 'Strategic Decision Council',
        roleSlotId: 'router',
        roleSlotType: 'router',
        roleLabel: 'Router',
        nodeId: 'router',
      },
      slotPolicy: {
        allowedToolNames: [],
      },
      architectureContext: {
        hostSessionId: 'host-chat',
        historySessionId: 'host-chat',
        sessionSurface: 'host-envelope',
      },
    });

    expect(sessions.updateRuntimeContext).toHaveBeenCalledWith(
      'arch-run-1-router',
      expect.objectContaining({
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'router',
        architectureContext: expect.objectContaining({
          architectureRunId: 'run-1',
          schemaId: 'strategic-decision-council',
          schemaName: 'Strategic Decision Council',
          roleSlotId: 'router',
          roleSlotType: 'router',
          roleLabel: 'Router',
          displayLabel: 'Router',
          hostSessionId: 'host-chat',
          historySessionId: 'host-chat',
          sessionSurface: 'technical-node',
          conversationVisibility: 'visible',
        }),
      }),
      { registerRuntimeProjectPath: true },
    );
  });

  it('REGRESSION: routes subagent history through the shared managed-history path before streaming', async () => {
    const managedHistory = [
      { role: 'system', content: 'managed system prompt' },
      { role: 'user', content: 'latest user prompt' },
    ];
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([{ type: 'text_delta', delta: 'done' }, { type: 'done' }])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([
        {
          role: 'assistant',
          content: '',
          reasoningContent: 'x'.repeat(6_000),
        },
      ]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: managedHistory,
        unboundedHistoryCount: 3,
      }),
    };
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager as Pick<SessionManagerService, 'persistAssistantMessage'>) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: 'managed system prompt', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-managed-history',
      objective: 'use shared history path',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
    });

    expect(sessionManager.loadHistoryForLLM).toHaveBeenCalled();
    const params = (llmSource.stream as ReturnType<typeof vi.fn>).mock.calls[0][0] as LLMSourceParams;
    expect(params.messages).toEqual(managedHistory);
  });

  it('emits chat:complete with the persisted assistant messageId instead of the child session id', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([{ type: 'text_delta', delta: 'done' }, { type: 'done' }])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const emit = vi.fn();
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-complete',
      objective: 'finish once',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
      emit,
    });

    const persistedMessageId = sessionManager.persistAssistantMessage.mock.calls.at(-1)?.[1] as string | undefined;
    const completeCall = emit.mock.calls.find((call: unknown[]) => call[0] === 'chat:complete');

    expect(persistedMessageId).toBeTruthy();
    expect(completeCall?.[1]).toEqual(expect.objectContaining({
      sessionId: result.childSessionId,
      messageId: persistedMessageId,
    }));
    expect((completeCall?.[1] as { messageId: string } | undefined)?.messageId).not.toBe(result.childSessionId);
  });

  it('persists a completion fallback message when the child finishes with no output', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([{ type: 'done' }])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const emit = vi.fn();
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-empty-complete',
      objective: 'Finish silently',
      availableTools: [],
      timeoutMs: 60000,
      vfsMode: 'shared',
      copyOutputs: false,
      emit,
    });

    expect(result.result).toBe('Sub-agent completed with no output.');
    expect(sessionManager.persistAssistantMessage).toHaveBeenCalledTimes(2);
    const fallbackCall = sessionManager.persistAssistantMessage.mock.calls.at(-1);
    expect((fallbackCall?.[2] as TurnState).text).toBe('Sub-agent completed with no output.');
    const completeCall = emit.mock.calls.find((call: unknown[]) => call[0] === 'chat:complete');
    expect(completeCall?.[1]).toEqual(expect.objectContaining({
      sessionId: result.childSessionId,
      messageId: fallbackCall?.[1],
    }));
  });

  it('includes parent download URLs in the returned result when isolated child outputs are copied back', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([{ type: 'text_delta', delta: 'Image generation completed.' }, { type: 'done' }])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const copiedFiles = [
      {
        fromPath: 'images/cat-hero.png',
        toPath: 'sub-agents/sub-child/images/cat-hero.png',
        sizeBytes: 123,
      },
    ];
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => copiedFiles) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-copy',
      objective: 'Generate one cat image',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: true,
    });

    expect(result.copiedFiles).toEqual(copiedFiles);
    expect(result.result).toContain('Image generation completed.');
    expect(result.result).toContain('/api/sessions/master/vfs/download?path=sub-agents%2Fsub-child%2Fimages%2Fcat-hero.png');
  });

  it('copies requested attachments into isolated child VFS and prepends attachment hint in child prompt', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([{ type: 'text_delta', delta: 'done' }, { type: 'done' }])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const vfs = {
      copySessionFiles: vi.fn()
        .mockReturnValueOnce([
          { fromPath: 'images/cat.png', toPath: 'attachments/images/cat.png', sizeBytes: 10 },
        ])
        .mockReturnValueOnce([]),
    };
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      vfs as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-attach',
      objective: 'Inspect attachment',
      attachments: ['images/cat.png'],
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
    });

    expect(vfs.copySessionFiles).toHaveBeenCalledWith(expect.objectContaining({
      fromSessionId: 'master',
      toSessionId: expect.stringMatching(/^sub-/),
      targetPrefix: 'attachments',
      filePaths: ['images/cat.png'],
    }));
    expect(sessionManager.persistUserMessage).toHaveBeenCalledWith(
      expect.stringMatching(/^sub-/),
      expect.stringContaining('attachments/images/cat.png'),
      undefined,
      expect.objectContaining({ turnId: expect.any(String) }),
    );
  });

  it('lets a first-level subagent see run_subagent, but hides it at the nested-depth limit', async () => {
    const streamCalls: LLMSourceParams[] = [];
    const llmSource: ILLMSource = {
      stream: vi.fn((params: LLMSourceParams) => {
        streamCalls.push(params);
        return streamFrom([{ type: 'text_delta', delta: 'done' }, { type: 'done' }]);
      }),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-1',
      objective: 'outer',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
    });
    await runtime.runSubagent({
      parentSessionId: 'sub-parent',
      parentToolCallId: 'call-2',
      objective: 'nested',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
      parentAgentRun: { agentRunId: 'parent-run', agentType: 'subagent', subagentDepth: 1 } as AgentRunContext,
    });

    expect(streamCalls[0].tools.map((tool) => tool.name)).toContain('run_subagent');
    expect(streamCalls[1].tools.map((tool) => tool.name)).not.toContain('run_subagent');
  });

  it('executes a subagent that delegates to one nested subagent', async () => {
    const sessionStreamCounts = new Map<string, number>();
    const llmSource: ILLMSource = {
      stream: vi.fn((params: LLMSourceParams) => {
        const count = sessionStreamCounts.get(params.sessionId) ?? 0;
        sessionStreamCounts.set(params.sessionId, count + 1);
        if (params.sessionId.startsWith('sub-') && count === 0 && params.tools.some((tool) => tool.name === 'run_subagent')) {
          return streamFrom([
            { type: 'tool_call', callId: 'nested-call', name: 'run_subagent', args: { objective: 'nested objective' } },
            { type: 'done' },
          ]);
        }
        if (count === 0) {
          return streamFrom([{ type: 'text_delta', delta: 'nested done' }, { type: 'done' }]);
        }
        return streamFrom([{ type: 'text_delta', delta: 'outer saw nested' }, { type: 'done' }]);
      }),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const sessions = { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) };
    let runtime: SubagentRuntimeService;
    const toolDispatch = {
      dispatch: vi.fn(async (callId: string, toolName: string, args: Record<string, unknown>, ctx: StreamContext, availableTools: ToolMeta[]): Promise<ToolResult> => {
        if (toolName !== 'run_subagent') return { callId, status: 'success', data: {} };
        if (!availableTools.some((tool) => tool.name === 'run_subagent')) {
          return { callId, status: 'error', errorCode: 'TOOL_NOT_AVAILABLE', errorMessage: 'run_subagent unavailable' };
        }
        const result = await runtime.runSubagent({
          parentSessionId: ctx.sessionId,
          parentToolCallId: callId,
          objective: typeof args['objective'] === 'string' ? args['objective'] : 'nested',
          availableTools,
          timeoutMs: 60000,
          vfsMode: 'isolated',
          copyOutputs: false,
          emit: ctx.emit,
          parentAgentRun: ctx.agentRun,
        });
        return { callId, status: 'success', data: result, sessionId: ctx.sessionId, toolName, agentRun: ctx.agentRun };
      }),
      getToolMetas: vi.fn(),
    };
    runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      toolDispatch as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      sessions as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-outer',
      objective: 'outer objective',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
      emit: vi.fn(),
    });

    expect(result.result).toBe('outer saw nested');
    expect(sessions.createWithId).toHaveBeenCalledTimes(2);
    expect(toolDispatch.dispatch).toHaveBeenCalledWith(
      'nested-call',
      'run_subagent',
      { objective: 'nested objective' },
      expect.objectContaining({ agentRun: expect.objectContaining({ subagentDepth: 1 }) }),
      expect.arrayContaining([expect.objectContaining({ name: 'run_subagent' })]),
    );
  });

  it('REGRESSION: nested subagent can delegate to a CLI agent and propagate the result', async () => {
    const sessionStreamCounts = new Map<string, number>();
    const childSessions: string[] = [];
    const llmSource: ILLMSource = {
      stream: vi.fn((params: LLMSourceParams) => {
        const count = sessionStreamCounts.get(params.sessionId) ?? 0;
        sessionStreamCounts.set(params.sessionId, count + 1);
        const canSpawnNested = params.tools.some((tool) => tool.name === 'run_subagent');
        const canRunCli = params.tools.some((tool) => tool.name === 'run_cli_agent');

        if (params.sessionId === childSessions[0] && count === 0 && canSpawnNested) {
          return streamFrom([
            { type: 'tool_call', callId: 'nested-call', name: 'run_subagent', args: { objective: 'nested should use CLI' } },
            { type: 'done' },
          ]);
        }

        if (params.sessionId === childSessions[1] && count === 0 && canRunCli) {
          return streamFrom([
            {
              type: 'tool_call',
              callId: 'nested-cli-call',
              name: 'run_cli_agent',
              args: {
                agentId: 'codex',
                workdir: 'C:\\Projekty\\kalio-forever',
                prompt: 'Read package.json and report the project name.',
              },
            },
            { type: 'done' },
          ]);
        }

        if (params.sessionId === childSessions[1]) {
          return streamFrom([{ type: 'text_delta', delta: 'nested saw CLI: kalio-forever' }, { type: 'done' }]);
        }

        return streamFrom([{ type: 'text_delta', delta: 'outer saw nested CLI result' }, { type: 'done' }]);
      }),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const sessions = {
      createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => {
        childSessions.push(id);
        return makeSession(id, dto.parentSessionId);
      }),
    };
    let runtime: SubagentRuntimeService;
    const toolDispatch = {
      dispatch: vi.fn(async (callId: string, toolName: string, args: Record<string, unknown>, ctx: StreamContext, availableTools: ToolMeta[]): Promise<ToolResult> => {
        if (toolName === 'run_subagent') {
          const result = await runtime.runSubagent({
            parentSessionId: ctx.sessionId,
            parentToolCallId: callId,
            objective: typeof args['objective'] === 'string' ? args['objective'] : 'nested',
            availableTools,
            timeoutMs: 60000,
            vfsMode: 'isolated',
            copyOutputs: false,
            emit: ctx.emit,
            parentAgentRun: ctx.agentRun,
          });
          return { callId, status: 'success', data: result, sessionId: ctx.sessionId, toolName, agentRun: ctx.agentRun };
        }

        if (toolName === 'run_cli_agent') {
          return {
            callId,
            status: 'success',
            data: {
              output: 'kalio-forever',
              exitCode: 0,
              durationMs: 25,
              agentId: args['agentId'],
              childSessionId: 'cli-child-from-nested',
            },
            sessionId: ctx.sessionId,
            toolName,
            agentRun: ctx.agentRun,
          };
        }

        return { callId, status: 'error', errorCode: 'TOOL_NOT_AVAILABLE', errorMessage: toolName };
      }),
      getToolMetas: vi.fn(),
    };
    runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      toolDispatch as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      sessions as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-outer',
      objective: 'outer should delegate to nested CLI',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
      emit: vi.fn(),
    });

    expect(result.result).toBe('outer saw nested CLI result');
    expect(sessions.createWithId).toHaveBeenCalledTimes(2);
    expect(toolDispatch.dispatch).toHaveBeenCalledWith(
      'nested-cli-call',
      'run_cli_agent',
      expect.objectContaining({
        agentId: 'codex',
        workdir: 'C:\\Projekty\\kalio-forever',
      }),
      expect.objectContaining({ agentRun: expect.objectContaining({ subagentDepth: 2 }) }),
      expect.arrayContaining([expect.objectContaining({ name: 'run_cli_agent' })]),
    );
    const nestedCliDispatch = (toolDispatch.dispatch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([callId]) => callId === 'nested-cli-call',
    );
    expect(nestedCliDispatch?.[4].map((tool: ToolMeta) => tool.name)).not.toContain('run_subagent');
  });

  it('REGRESSION: dispatches a CLI tool call emitted as raw XML from a child subagent', async () => {
    const rawToolCall = [
      '<tool_call>',
      '<name>run_cli_agent</name>',
      '<parameters>',
      '<agentId>gemini</agentId>',
      '<workdir>C:\\Projekty\\ProjectPlanner</workdir>',
      '<prompt>Inspect the project and report status.</prompt>',
      '</parameters>',
      '</tool_call>',
    ].join('');
    const persistedAssistantSnapshots: Array<{ text: string; toolCalls: unknown[] }> = [];
    const llmSource: ILLMSource = {
      stream: vi.fn((params: LLMSourceParams) => {
        const hasToolResult = params.messages.some((message) => message.role === 'tool');
        if (!hasToolResult) {
          return streamFrom([{ type: 'text_delta', delta: rawToolCall }, { type: 'done' }]);
        }
        return streamFrom([{ type: 'text_delta', delta: 'CLI finished.' }, { type: 'done' }]);
      }),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn(async (_sessionId: string, _messageId: string, state: TurnState) => {
        persistedAssistantSnapshots.push({
          text: state.text,
          toolCalls: [...state.toolCalls],
        });
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn()
        .mockResolvedValueOnce({ history: [{ role: 'user', content: 'delegate to CLI' }], unboundedHistoryCount: 1 })
        .mockResolvedValueOnce({ history: [{ role: 'tool', content: '{"output":"ok"}', toolCallId: 'xml-tool-call-1' }], unboundedHistoryCount: 1 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const toolDispatch = {
      dispatch: vi.fn(async (callId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> => ({
        callId,
        status: 'success',
        data: { output: 'ok', exitCode: 0, durationMs: 10, agentId: args['agentId'] },
      })),
      getToolMetas: vi.fn(),
    };
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      toolDispatch as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-cli-xml',
      objective: 'delegate to CLI',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
    });

    expect(toolDispatch.dispatch).toHaveBeenCalledWith(
      expect.any(String),
      'run_cli_agent',
      {
        agentId: 'gemini',
        workdir: 'C:\\Projekty\\ProjectPlanner',
        prompt: 'Inspect the project and report status.',
      },
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ name: 'run_cli_agent' })]),
    );
    expect(sessionManager.saveToolResult).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.stringContaining('"output":"ok"'),
      expect.objectContaining({ turnId: expect.any(String) }),
    );
    expect(persistedAssistantSnapshots[0]).toEqual({
      text: '',
      toolCalls: [
        expect.objectContaining({
          name: 'run_cli_agent',
          args: expect.objectContaining({ agentId: 'gemini' }),
        }),
      ],
    });
    expect(result.result).toBe('CLI finished.');
  });

  it('does not dispatch MiMo function-style raw XML for non-compat tools from a child subagent', async () => {
    const rawToolCall = [
      '<tool_call>',
      '<function=vfs_read>',
      '<parameter=filePath>README.md</parameter>',
      '</function>',
      '</tool_call>',
    ].join('');
    const persistedAssistantSnapshots: Array<{ text: string; toolCalls: unknown[] }> = [];
    const llmSource: ILLMSource = {
      stream: vi.fn((params: LLMSourceParams) => {
        const hasToolResult = params.messages.some((message) => message.role === 'tool');
        if (!hasToolResult) {
          return streamFrom([{ type: 'text_delta', delta: rawToolCall }, { type: 'done' }]);
        }
        return streamFrom([{ type: 'text_delta', delta: 'VFS read finished.' }, { type: 'done' }]);
      }),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn(async (_sessionId: string, _messageId: string, state: TurnState) => {
        persistedAssistantSnapshots.push({
          text: state.text,
          toolCalls: [...state.toolCalls],
        });
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn()
        .mockResolvedValueOnce({ history: [{ role: 'user', content: 'read vfs' }], unboundedHistoryCount: 1 })
        .mockResolvedValueOnce({ history: [{ role: 'tool', content: '{"content":"ok"}', toolCallId: 'xml-tool-call-1' }], unboundedHistoryCount: 1 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const toolDispatch = {
      dispatch: vi.fn(async (callId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> => ({
        callId,
        status: 'success',
        data: { content: `read:${args['filePath']}` },
      })),
      getToolMetas: vi.fn(),
    };
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      toolDispatch as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-vfs-xml',
      objective: 'read vfs',
      availableTools: tools.filter((tool) => tool.name === 'vfs_read'),
      timeoutMs: 60000,
      vfsMode: 'shared',
      copyOutputs: false,
    });

    expect(toolDispatch.dispatch).not.toHaveBeenCalled();
    expect(persistedAssistantSnapshots[0]).toEqual({
      text: rawToolCall,
      toolCalls: [],
    });
    expect(result.result).toBe(rawToolCall);
  });

  it('REGRESSION: raw XML run_cli_agent flows through real dispatch and run_cli_agent tool', async () => {
    const rawToolCall = [
      '<tool_call>',
      '<name>run_cli_agent</name>',
      '<parameters>',
      '<agentId>gemini</agentId>',
      '<workdir>C:\\Projekty\\kalio-forever</workdir>',
      '<timeoutMs>120000</timeoutMs>',
      '<prompt>Read package.json only.</prompt>',
      '</parameters>',
      '</tool_call>',
    ].join('');
    const llmSource: ILLMSource = {
      stream: vi.fn((params: LLMSourceParams) => {
        const hasToolResult = params.messages.some((message) => message.role === 'tool');
        if (!hasToolResult) {
          return streamFrom([{ type: 'text_delta', delta: rawToolCall }, { type: 'done' }]);
        }
        return streamFrom([{ type: 'text_delta', delta: 'CLI result received.' }, { type: 'done' }]);
      }),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn()
        .mockResolvedValueOnce({ history: [{ role: 'user', content: 'delegate to CLI' }], unboundedHistoryCount: 1 })
        .mockResolvedValueOnce({ history: [{ role: 'tool', content: '{"output":"kalio-forever"}', toolCallId: 'xml-tool-call-1' }], unboundedHistoryCount: 1 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const cliAgent = {
      getAdapter: vi.fn().mockReturnValue({ displayName: 'Gemini CLI' }),
      listAll: vi.fn().mockResolvedValue([
        { id: 'gemini', displayName: 'Gemini CLI', available: true },
      ]),
      run: vi.fn().mockResolvedValue({
        output: 'kalio-forever',
        exitCode: 0,
        durationMs: 25,
        agentId: 'gemini',
      }),
    };
    const cliAgentSessions = {
      createChildSession: vi.fn().mockResolvedValue({
        id: 'cli-child-1',
        personaId: 'default',
        title: 'Gemini CLI',
        kind: 'cli-agent',
        parentSessionId: 'sub-session',
        parentToolCallId: 'xml-tool-call-1',
        createdAt: 1,
        updatedAt: 1,
      }),
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantToolCallMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    };
    const runCliAgentTool = new RunCliAgentTool(
      { isAllowed: vi.fn().mockResolvedValue(true) } as never,
      cliAgent as never,
      cliAgentSessions as never,
    );
    const dispatch = new ToolDispatchService(
      [{
        meta: tools.find((tool) => tool.name === 'run_cli_agent')!,
        execute: (request) => runCliAgentTool.execute(request),
      }],
      null,
      { resolveApproval: vi.fn().mockResolvedValue({ status: 'approved', source: 'test' }) } as never,
      null,
    );
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      dispatch,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async () => makeSession('sub-session', 'master')) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-cli-real-dispatch',
      objective: 'delegate to CLI',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
      emit: vi.fn(),
    });

    expect(cliAgent.run).toHaveBeenCalledWith(expect.objectContaining<Partial<RunCliAgentRequest>>({
      agentId: 'gemini',
      workdir: 'C:\\Projekty\\kalio-forever',
      prompt: 'Read package.json only.',
      inactivityTimeoutMs: 180000,
      sessionId: 'cli-child-1',
    }));
    expect(cliAgentSessions.saveToolResult).toHaveBeenCalledWith(
      'cli-child-1',
      expect.any(String),
      expect.stringContaining('"childSessionId":"cli-child-1"'),
    );
    expect(cliAgentSessions.persistAssistantMessage).toHaveBeenCalledWith('cli-child-1', expect.stringContaining('kalio-forever'));
    expect(cliAgentSessions.persistAssistantToolCallMessage).toHaveBeenCalledWith(
      'cli-child-1',
      expect.any(String),
      expect.objectContaining({
        agentId: 'gemini',
        prompt: 'Read package.json only.',
        workdir: 'C:\\Projekty\\kalio-forever',
      }),
    );
    expect(sessionManager.saveToolResult).toHaveBeenCalledWith(
      expect.stringMatching(/^sub-/),
      expect.any(String),
      expect.stringContaining('kalio-forever'),
      expect.objectContaining({ turnId: expect.any(String) }),
    );
    expect(result.result).toBe('CLI result received.');
  });

  it('logs normalized child tool audit rows from subagent tool execution', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn((params: LLMSourceParams) => {
        const hasResult = params.messages.some((message) => message.role === 'tool');
        if (!hasResult) {
          return streamFrom([
            { type: 'tool_call', callId: 'read-call-1', name: 'vfs_read', args: { filePath: 'project/SimulationApp.tsx' } },
            { type: 'done' },
          ]);
        }
        return streamFrom([{ type: 'text_delta', delta: 'read complete' }, { type: 'done' }]);
      }),
    };
    const savedToolResults: Array<{ toolCallId: string; content: string }> = [];
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn(async (_sessionId: string, toolCallId: string, content: string) => {
        savedToolResults.push({ toolCallId, content });
      }),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn(async () => ({
        history: savedToolResults.length > 0
          ? [{ role: 'tool' as const, content: savedToolResults[0]!.content, toolCallId: savedToolResults[0]!.toolCallId }]
          : [],
        unboundedHistoryCount: 0,
        compacted: false,
      })),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const audit = { log: vi.fn().mockResolvedValue('audit-id'), update: vi.fn().mockResolvedValue(undefined) };
    const llmSourceWithConfig = {
      ...llmSource,
      getConfig: vi.fn(async () => ({
        provider: 'xiaomimimo' as const,
        apiKey: '',
        baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
        model: 'mimo-v2.5-pro',
        source: 'db' as const,
      })),
    };
    const runtime = buildSubagentRuntime(
      llmSourceWithConfig,
      makeProcessor(sessionManager) as StreamProcessorService,
      {
        dispatch: vi.fn(async (callId: string): Promise<ToolResult> => ({
          callId,
          status: 'success',
          data: {
            path: 'project/SimulationApp.tsx',
            content: 'const MAX_ENTITIES = 10_000_000;',
          },
        })),
        getToolMetas: vi.fn().mockReturnValue(tools),
      } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: 'mimo-v2.5', availableSkills: [], kv: {} }) } as unknown as PersonaService,
      audit as never,
    );

    await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'parent-call-1',
      objective: 'read the simulation file',
      auditContext: {
        architectureRunId: 'architecture-run-1',
        nodeId: 'analyst',
        roleSlotId: 'analyst',
      },
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'shared',
      copyOutputs: false,
    });

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringMatching(/^sub-/),
      type: 'llm_request',
      label: expect.stringMatching(/^subagent-/),
      data: expect.objectContaining({
        kind: 'subagent_llm_request',
        architectureRunId: 'architecture-run-1',
        childAgentRunId: expect.stringMatching(/^subagent-/),
        parentSessionId: 'master',
        parentToolCallId: 'parent-call-1',
        iteration: 1,
        toolCount: tools.length,
        provider: 'xiaomimimo',
        model: 'mimo-v2.5',
        modelSource: 'persona',
        personaModel: 'mimo-v2.5',
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringMatching(/^sub-/),
      type: 'llm_response',
      label: expect.stringMatching(/^subagent-/),
      data: expect.objectContaining({
        kind: 'subagent_llm_response',
        architectureRunId: 'architecture-run-1',
        childAgentRunId: expect.stringMatching(/^subagent-/),
        parentSessionId: 'master',
        parentToolCallId: 'parent-call-1',
        iteration: 1,
        provider: 'xiaomimimo',
        model: 'mimo-v2.5',
        modelSource: 'persona',
        personaModel: 'mimo-v2.5',
      }),
      chunkCount: 0,
    }));
    expect(audit.update).toHaveBeenCalledWith('audit-id', expect.objectContaining({
      chunkCount: expect.any(Number),
      durationMs: expect.any(Number),
      data: expect.objectContaining({
        kind: 'subagent_llm_response',
        architectureRunId: 'architecture-run-1',
        toolCallCount: expect.any(Number),
        provider: 'xiaomimimo',
        model: 'mimo-v2.5',
        modelSource: 'persona',
        personaModel: 'mimo-v2.5',
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringMatching(/^sub-/),
      type: 'tool_call',
      label: 'vfs_read',
      data: expect.objectContaining({
        kind: 'file_tool_call',
        domain: 'architecture',
        architectureRunId: 'architecture-run-1',
        childAgentRunId: expect.stringMatching(/^subagent-/),
        parentSessionId: 'master',
        parentToolCallId: 'parent-call-1',
        fileTool: expect.objectContaining({ path: 'project/SimulationApp.tsx' }),
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringMatching(/^sub-/),
      type: 'tool_result',
      label: 'vfs_read',
      data: expect.objectContaining({
        kind: 'file_tool_result',
        domain: 'architecture',
        architectureRunId: 'architecture-run-1',
        childAgentRunId: expect.stringMatching(/^subagent-/),
        parentSessionId: 'master',
        parentToolCallId: 'parent-call-1',
        fileTool: expect.objectContaining({ path: 'project/SimulationApp.tsx' }),
      }),
    }));
  });

  it('falls back to runtime LLM config in audit rows when the persona model is blank', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn((params: LLMSourceParams) => {
        const hasResult = params.messages.some((message) => message.role === 'tool');
        if (!hasResult) {
          return streamFrom([
            { type: 'tool_call', callId: 'read-call-runtime-fallback', name: 'vfs_read', args: { filePath: 'README.md' } },
            { type: 'done' },
          ]);
        }
        return streamFrom([{ type: 'text_delta', delta: 'runtime fallback complete' }, { type: 'done' }]);
      }),
      getConfig: vi.fn(async () => ({
        provider: 'xiaomimimo' as const,
        apiKey: '',
        baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
        model: 'mimo-v2.5-pro',
        source: 'db' as const,
      })),
    };
    const savedToolResults: Array<{ toolCallId: string; content: string }> = [];
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn(async (_sessionId: string, toolCallId: string, content: string) => {
        savedToolResults.push({ toolCallId, content });
      }),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn(async () => ({
        history: savedToolResults.length > 0
          ? [{ role: 'tool' as const, content: savedToolResults[0]!.content, toolCallId: savedToolResults[0]!.toolCallId }]
          : [],
        unboundedHistoryCount: 0,
        compacted: false,
      })),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const audit = { log: vi.fn().mockResolvedValue('audit-id'), update: vi.fn().mockResolvedValue(undefined) };
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      {
        dispatch: vi.fn(async (callId: string): Promise<ToolResult> => ({
          callId,
          status: 'success',
          data: { content: 'ok' },
        })),
        getToolMetas: vi.fn(),
      } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '   ', availableSkills: [], kv: {} }) } as unknown as PersonaService,
      audit as never,
    );

    await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'parent-call-runtime-fallback',
      objective: 'read with runtime fallback audit',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'shared',
      copyOutputs: false,
    });

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      type: 'llm_request',
      data: expect.objectContaining({
        parentToolCallId: 'parent-call-runtime-fallback',
        provider: 'xiaomimimo',
        model: 'mimo-v2.5-pro',
        modelSource: 'db',
        personaModel: '',
      }),
    }));
    expect(audit.update).toHaveBeenCalledWith('audit-id', expect.objectContaining({
      data: expect.objectContaining({
        provider: 'xiaomimimo',
        model: 'mimo-v2.5-pro',
        modelSource: 'db',
        personaModel: '',
      }),
    }));
  });

  it('uses request model before persona model and records request as the audit source', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'text_delta', delta: 'request model complete' },
        { type: 'done' },
      ])),
      getConfig: vi.fn(async () => ({
        provider: 'xiaomimimo' as const,
        apiKey: '',
        baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
        model: 'mimo-v2.5-pro',
        source: 'db' as const,
      })),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const audit = { log: vi.fn().mockResolvedValue('audit-id'), update: vi.fn().mockResolvedValue(undefined) };
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: 'mimo-v2.5-pro', availableSkills: [], kv: {} }) } as unknown as PersonaService,
      audit as never,
    );

    await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'parent-call-request-model',
      objective: 'use request model',
      availableTools: [],
      timeoutMs: 60000,
      vfsMode: 'shared',
      copyOutputs: false,
      model: 'mimo-v2.5',
    });

    expect(llmSource.stream).toHaveBeenCalledWith(expect.objectContaining({
      model: 'mimo-v2.5',
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      type: 'llm_request',
      data: expect.objectContaining({
        parentToolCallId: 'parent-call-request-model',
        provider: 'xiaomimimo',
        model: 'mimo-v2.5',
        modelSource: 'request',
        personaModel: 'mimo-v2.5-pro',
        requestModel: 'mimo-v2.5',
      }),
    }));
    expect(audit.update).toHaveBeenCalledWith('audit-id', expect.objectContaining({
      data: expect.objectContaining({
        model: 'mimo-v2.5',
        modelSource: 'request',
        personaModel: 'mimo-v2.5-pro',
        requestModel: 'mimo-v2.5',
      }),
    }));
  });

  it('returns an explicit incomplete result when max iterations are exhausted after tool calls', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'text_delta', delta: 'Let me inspect one more file.' },
        { type: 'tool_call', callId: 'tool-1', name: 'vfs_read', args: { filePath: 'README.md' } },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [{ role: 'user', content: 'read' }], unboundedHistoryCount: 1 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const toolDispatch = {
      dispatch: vi.fn(async (callId: string): Promise<ToolResult> => ({
        callId,
        status: 'success',
        data: { content: 'ok' },
      })),
      getToolMetas: vi.fn(),
    };
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      toolDispatch as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-max-iterations',
      objective: 'keep reading files',
      availableTools: tools.filter((tool) => tool.name === 'vfs_read'),
      timeoutMs: 60000,
      maxIterations: 1,
      vfsMode: 'shared',
      copyOutputs: false,
    });

    expect(result.result).toContain('Sub-agent stopped after 1 tool iteration without producing a final answer.');
    expect(result.result).toContain('Last assistant text before stopping: Let me inspect one more file.');
    expect(result.result).not.toBe('Let me inspect one more file.');
    expect(toolDispatch.dispatch).toHaveBeenCalledOnce();
  });

  it('uses 30 as the fallback max tool iteration budget when no override exists', async () => {
    let iteration = 0;
    const llmSource: ILLMSource = {
      stream: vi.fn(() => {
        iteration += 1;
        return streamFrom([
          { type: 'text_delta', delta: `Inspecting path ${iteration}.` },
          { type: 'tool_call', callId: `tool-${iteration}`, name: 'vfs_read', args: { filePath: `file-${iteration}.md` } },
          { type: 'done' },
        ]);
      }),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [{ role: 'user', content: 'read' }], unboundedHistoryCount: 1 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const toolDispatch = {
      dispatch: vi.fn(async (callId: string): Promise<ToolResult> => ({
        callId,
        status: 'success',
        data: { content: 'ok' },
      })),
      getToolMetas: vi.fn(),
    };
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      toolDispatch as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-default-iterations',
      objective: 'keep reading files',
      availableTools: tools.filter((tool) => tool.name === 'vfs_read'),
      timeoutMs: 60000,
      vfsMode: 'shared',
      copyOutputs: false,
    });

    expect(toolDispatch.dispatch).toHaveBeenCalledTimes(30);
    expect(result.result).toContain('Sub-agent stopped after 30 tool iterations without producing a final answer.');
  });

  it('persists a terminal assistant fallback message when max iterations are exhausted', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'text_delta', delta: 'Let me inspect one more file.' },
        { type: 'tool_call', callId: 'tool-1', name: 'vfs_read', args: { filePath: 'README.md' } },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [{ role: 'user', content: 'read' }], unboundedHistoryCount: 1 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const toolDispatch = {
      dispatch: vi.fn(async (callId: string): Promise<ToolResult> => ({
        callId,
        status: 'success',
        data: { content: 'ok' },
      })),
      getToolMetas: vi.fn(),
    };
    const emit = vi.fn();
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      toolDispatch as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-max-iterations-visible-output',
      objective: 'keep reading files',
      availableTools: tools.filter((tool) => tool.name === 'vfs_read'),
      timeoutMs: 60000,
      maxIterations: 1,
      vfsMode: 'shared',
      copyOutputs: false,
      emit,
    });

    expect(sessionManager.persistAssistantMessage).toHaveBeenCalledTimes(2);
    const terminalFallbackCall = sessionManager.persistAssistantMessage.mock.calls.at(-1);
    expect(terminalFallbackCall?.[0]).toBe(result.childSessionId);
    expect((terminalFallbackCall?.[2] as TurnState).text).toContain(
      'Sub-agent stopped after 1 tool iteration without producing a final answer.',
    );
    const completeCall = emit.mock.calls.find((call: unknown[]) => call[0] === 'chat:complete');
    expect(completeCall?.[1]).toEqual(expect.objectContaining({
      sessionId: result.childSessionId,
      messageId: terminalFallbackCall?.[1],
    }));
  });

  it('persists an error fallback message with the last streamed text when the child run throws', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(async function* stream(): AsyncGenerator<InternalLLMChunk> {
        yield { type: 'text_delta', delta: 'partial result' };
        throw new Error('stream exploded');
      }),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const emit = vi.fn();
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    await expect(runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-error-fallback',
      objective: 'Stream and fail',
      availableTools: [],
      timeoutMs: 60000,
      vfsMode: 'shared',
      copyOutputs: false,
      emit,
    })).rejects.toThrow('stream exploded');

    expect(sessionManager.persistAssistantMessage).toHaveBeenCalledTimes(1);
    const fallbackCall = sessionManager.persistAssistantMessage.mock.calls[0];
    const startCall = emit.mock.calls.find((call: unknown[]) => call[0] === 'agent:start');
    const childSessionId = (startCall?.[1] as { sessionId: string } | undefined)?.sessionId;

    expect(fallbackCall?.[0]).toBe(childSessionId);
    expect((fallbackCall?.[2] as TurnState).text).toBe(
      'Sub-agent failed: stream exploded. Last assistant text before failure: partial result',
    );
    expect(emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
      sessionId: childSessionId,
      code: 'LLM_ERROR',
      message: 'stream exploded',
      hadContent: true,
    }));
  });

  it('persists a structured-output fallback when the repair retry also fails', async () => {
    const structuredOutputError = Object.assign(
      new Error('Structured output response failed schema_mismatch. Preview: prose before bad JSON'),
      { code: 'LLM_BAD_STRUCTURED_OUTPUT' },
    );
    const llmSource: ILLMSource = {
      stream: vi.fn(() => throwingStream(structuredOutputError)),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue({ id: 'prompt-1' }),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
    const emit = vi.fn();
    const runtime = buildSubagentRuntime(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    await expect(runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-structured-error-fallback',
      objective: 'Return malformed structured output',
      availableTools: [],
      structuredOutput: {
        name: 'architecture_router_output',
        schema: { type: 'object', properties: { nextAction: { const: 'finalize' } }, required: ['nextAction'] },
        strict: true,
      },
      timeoutMs: 60000,
      vfsMode: 'shared',
      copyOutputs: false,
      emit,
    })).rejects.toThrow('Structured output response failed schema_mismatch');

    expect(llmSource.stream).toHaveBeenCalledTimes(2);
    expect(sessionManager.persistAssistantMessage).toHaveBeenCalledTimes(1);
    const fallbackCall = sessionManager.persistAssistantMessage.mock.calls[0];
    const startCall = emit.mock.calls.find((call: unknown[]) => call[0] === 'agent:start');
    const childSessionId = (startCall?.[1] as { sessionId: string } | undefined)?.sessionId;

    expect(fallbackCall?.[0]).toBe(childSessionId);
    expect((fallbackCall?.[2] as TurnState).text).toContain(
      'Sub-agent failed: Structured output response failed schema_mismatch. Preview: prose before bad JSON.',
    );
    expect(emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
      sessionId: childSessionId,
      code: 'LLM_BAD_STRUCTURED_OUTPUT',
      message: 'Structured output response failed schema_mismatch. Preview: prose before bad JSON',
      hadContent: false,
    }));
  });

  it('does not mask the original timeout when persisting the terminal fallback message fails', async () => {
    vi.useFakeTimers();
    try {
      const llmSource: ILLMSource = {
        stream: vi.fn(async function* stream(): AsyncGenerator<InternalLLMChunk> {
          await new Promise((resolve) => setTimeout(resolve, 100));
          yield { type: 'done' };
        }),
      };
      const sessionManager = {
        persistUserMessage: vi.fn().mockResolvedValue(undefined),
        persistAssistantMessage: vi.fn().mockRejectedValueOnce(new Error('persist failed')),
        saveToolResult: vi.fn().mockResolvedValue(undefined),
        loadHistory: vi.fn().mockResolvedValue([]),
        loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
      } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory' | 'loadHistoryForLLM'>;
      const emit = vi.fn();
      const audit = { log: vi.fn().mockResolvedValue(undefined) } satisfies Pick<AuditService, 'log'>;
      const runtime = buildSubagentRuntime(
        llmSource,
        makeProcessor(sessionManager) as StreamProcessorService,
        { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
        sessionManager as unknown as SessionManagerService,
        { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
        { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
        { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
        audit as unknown as AuditService,
      );

      const runPromise = runtime.runSubagent({
        parentSessionId: 'master',
        parentToolCallId: 'call-timeout-persist-fails',
        objective: 'Take too long',
        availableTools: [],
        timeoutMs: 50,
        vfsMode: 'shared',
        copyOutputs: false,
        emit,
      });

      const observation: {
        value:
          | { status: 'pending' }
          | { status: 'resolved' }
          | { status: 'rejected'; error: unknown };
      } = { value: { status: 'pending' } };
      void runPromise.then(
        () => {
          observation.value = { status: 'resolved' };
        },
        (error: unknown) => {
          observation.value = { status: 'rejected', error };
        },
      );

      await vi.advanceTimersByTimeAsync(51);
      await Promise.resolve();

      const settled = observation.value;
      expect(settled.status).toBe('rejected');
      if (settled.status !== 'rejected') {
        throw new Error(`Expected timeout rejection, got ${settled.status}`);
      }
      expect((settled.error as Error).message).toBe('Sub-agent timed out after 50ms');
      expect(sessionManager.persistAssistantMessage).toHaveBeenCalledTimes(1);
      const startCall = emit.mock.calls.find((call: unknown[]) => call[0] === 'agent:start');
      const childSessionId = (startCall?.[1] as { sessionId: string } | undefined)?.sessionId;
      expect(emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
        sessionId: childSessionId,
        code: 'LLM_TIMEOUT',
        message: 'Sub-agent timed out after 50ms',
      }));
      expect(emit).toHaveBeenCalledWith('agent:done', expect.objectContaining({ sessionId: childSessionId }));
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: childSessionId,
        type: 'error',
        label: 'subagent:error',
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
