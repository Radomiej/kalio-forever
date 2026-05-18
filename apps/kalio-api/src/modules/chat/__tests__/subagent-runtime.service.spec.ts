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

const tools: ToolMeta[] = [
  { name: 'run_subagent', description: 'spawn child', parameters: {}, requiresConfirmation: false },
  { name: 'run_cli_agent', description: 'run CLI child', parameters: {}, requiresConfirmation: true },
  { name: 'vfs_write', description: 'write file', parameters: {}, requiresConfirmation: true },
];

async function* streamFrom(chunks: InternalLLMChunk[]): AsyncIterable<InternalLLMChunk> {
  for (const chunk of chunks) yield chunk;
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
          const parsedToolCall = parseRawXmlToolCall(ctx.state.text);
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

describe('SubagentRuntimeService nested subagents', () => {
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
      const runtime = new SubagentRuntimeService(
        llmSource,
        makeProcessor(sessionManager) as StreamProcessorService,
        { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
        sessionManager as unknown as SessionManagerService,
        { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => makeSession(id, dto.parentSessionId)) } as unknown as SessionsService,
        { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
        { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
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
        code: 'LLM_ERROR',
        message: 'Sub-agent timed out after 50ms',
        hadContent: false,
      }));
      expect(emit).toHaveBeenCalledWith('agent:done', expect.objectContaining({ sessionId: childSessionId }));
      expect(emit.mock.calls.some((call: unknown[]) => call[0] === 'chat:complete')).toBe(false);
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
    };
    const runtime = new SubagentRuntimeService(
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
    expect(sessions.createWithId).not.toHaveBeenCalled();
    expect(sessionManager.persistUserMessage).toHaveBeenCalledWith('sub-existing', 'Refine the existing page');
    expect(result.childSessionId).toBe('sub-existing');
    expect(result.result).toBe('follow-up done');
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
    const runtime = new SubagentRuntimeService(
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
    const runtime = new SubagentRuntimeService(
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
    const runtime = new SubagentRuntimeService(
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
    const runtime = new SubagentRuntimeService(
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
    const runtime = new SubagentRuntimeService(
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
    runtime = new SubagentRuntimeService(
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
    const runtime = new SubagentRuntimeService(
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
    );
    const runtime = new SubagentRuntimeService(
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
      timeoutMs: 180000,
      sessionId: 'cli-child-1',
    }));
    expect(cliAgentSessions.saveToolResult).toHaveBeenCalledWith(
      'cli-child-1',
      expect.any(String),
      expect.stringContaining('"childSessionId":"cli-child-1"'),
    );
    expect(sessionManager.saveToolResult).toHaveBeenCalledWith(
      expect.stringMatching(/^sub-/),
      expect.any(String),
      expect.stringContaining('"output":"kalio-forever"'),
    );
    expect(result.result).toBe('CLI result received.');
  });
});
