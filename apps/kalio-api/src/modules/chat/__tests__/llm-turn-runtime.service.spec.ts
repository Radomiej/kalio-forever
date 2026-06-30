import { describe, expect, it, vi } from 'vitest';
import type { ToolMeta } from '@kalio/types';
import type { EmitFn, StreamContext } from '../interfaces/stream-context.interface';
import type { ILLMSource } from '../interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';
import { LLMTurnRuntimeService } from '../llm-turn-runtime.service';
import type { SessionManagerService } from '../session-manager.service';
import type { StreamProcessorService } from '../stream-processor.service';
import type { ToolDispatchService } from '../tool-dispatch.service';
import type { AuditService } from '../audit.service';

async function* streamFrom(chunks: InternalLLMChunk[]): AsyncIterable<InternalLLMChunk> {
  for (const chunk of chunks) yield chunk;
}

describe('LLMTurnRuntimeService', () => {
  it('returns provider structured output without routing it through display chunk handlers', async () => {
    const structuredOutput = {
      name: 'architecture_router_output',
      schema: { type: 'object', properties: { nextAction: { const: 'route_to' } }, required: ['nextAction'] },
      strict: true,
    };
    const outputValue = { nextAction: 'route_to', targetNodeId: 'implementer' };
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'structured_output', value: outputValue } as unknown as InternalLLMChunk,
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const processor = {
      process: vi.fn(async () => undefined),
    } satisfies Pick<StreamProcessorService, 'process'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      processor as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      { dispatch: vi.fn() } as unknown as ToolDispatchService,
    );

    const result = await runtime.runAgentLoop({
      runtimeKind: 'agent-flow-branch',
      sessionId: 'sid',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas: [],
      structuredOutput,
      abortSignal: new AbortController().signal,
      emit: vi.fn() as EmitFn,
      maxIterations: 1,
    });

    expect(result.structuredOutput).toEqual(outputValue);
    expect(llmSource.stream).toHaveBeenCalledWith(expect.objectContaining({ structuredOutput }));
    expect(processor.process).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'structured_output' }),
      expect.any(Object),
    );
  });

  it('passes the current tool-loop limit to before-iteration callbacks', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'text_delta', delta: 'done' },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const processor = {
      process: vi.fn(async (chunk: InternalLLMChunk, ctx: { state: { appendText: (delta: string) => void } }) => {
        if (chunk.type === 'text_delta') ctx.state.appendText(chunk.delta);
      }),
    } satisfies Pick<StreamProcessorService, 'process'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      processor as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      { dispatch: vi.fn() } as unknown as ToolDispatchService,
    );
    const onBeforeIteration = vi.fn().mockResolvedValue(undefined);

    await runtime.runAgentLoop({
      runtimeKind: 'chat',
      sessionId: 'sid',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas: [],
      abortSignal: new AbortController().signal,
      emit: vi.fn() as EmitFn,
      maxIterations: 7,
      firstMessageId: 'first-message',
      callbacks: { onBeforeIteration },
    });

    expect(onBeforeIteration).toHaveBeenCalledWith(1, 'first-message', 7);
  });

  it('routes every internal stream through llmSource.stream', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'text_delta', delta: 'hello' },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const processor = {
      process: vi.fn(async (chunk: InternalLLMChunk, ctx: { state: { appendText: (delta: string) => void } }) => {
        if (chunk.type === 'text_delta') ctx.state.appendText(chunk.delta);
      }),
    } satisfies Pick<StreamProcessorService, 'process'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      processor as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      { dispatch: vi.fn() } as unknown as ToolDispatchService,
    );
    const emit = vi.fn() as EmitFn;

    const result = await runtime.runAgentLoop({
      runtimeKind: 'chat',
      sessionId: 'sid',
      turnId: 'turn-1',
      promptMessageId: 'user-1',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas: [],
      abortSignal: new AbortController().signal,
      emit,
      maxIterations: 3,
    });

    expect(llmSource.stream).toHaveBeenCalledTimes(1);
    expect(result.finalText).toBe('hello');
    expect(sessionManager.loadHistoryForLLM).toHaveBeenCalledWith('sid', {
      systemPrompt: 'prompt',
      toolMetas: [],
    });
  });

  it('does not enable raw XML tool-call parsing unless the request opts in', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const seenRawXmlToolNames: Array<readonly string[] | undefined> = [];
    const processor = {
      process: vi.fn(async (_chunk: InternalLLMChunk, ctx: StreamContext) => {
        seenRawXmlToolNames.push(ctx.rawXmlToolNames);
      }),
    } satisfies Pick<StreamProcessorService, 'process'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      processor as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      { dispatch: vi.fn() } as unknown as ToolDispatchService,
    );

    await runtime.runAgentLoop({
      runtimeKind: 'subagent',
      sessionId: 'sid',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas: [{ name: 'run_cli_agent', description: 'CLI', parameters: {}, requiresConfirmation: true }],
      agentRun: { agentRunId: 'sub-1', agentType: 'subagent' },
      abortSignal: new AbortController().signal,
      emit: vi.fn() as EmitFn,
      maxIterations: 1,
    });

    expect(seenRawXmlToolNames).toEqual([undefined]);
  });

  it('persists tool results with the opening prompt linkage for the turn', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'tool_call', callId: 'call-1', name: 'memory_search', args: { q: 'x' } },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const processor = {
      process: vi.fn(async (chunk: InternalLLMChunk, ctx: StreamContext) => {
        if (chunk.type === 'tool_call') {
          ctx.state.addToolCall({ id: chunk.callId, name: chunk.name, args: chunk.args });
        }
      }),
    } satisfies Pick<StreamProcessorService, 'process'>;
    const toolDispatch = {
      dispatch: vi.fn().mockResolvedValue({ callId: 'call-1', status: 'success', data: { hits: [] } }),
    } satisfies Pick<ToolDispatchService, 'dispatch'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      processor as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      toolDispatch as unknown as ToolDispatchService,
    );

    await runtime.runAgentLoop({
      runtimeKind: 'chat',
      sessionId: 'sid',
      turnId: 'turn-1',
      promptMessageId: 'user-1',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas: [],
      abortSignal: new AbortController().signal,
      emit: vi.fn() as EmitFn,
      maxIterations: 1,
    });

    expect(sessionManager.saveToolResult).toHaveBeenCalledWith(
      'sid',
      'call-1',
      JSON.stringify({ hits: [] }),
      { turnId: 'turn-1', promptMessageId: 'user-1' },
    );
  });

  it('logs tool audit rows using typed ToolMeta domains', async () => {
    const toolMetas: ToolMeta[] = [{
      name: 'custom_reader',
      domain: 'vfs',
      description: 'Custom reader',
      parameters: {},
      requiresConfirmation: false,
    }];
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'tool_call', callId: 'call-1', name: 'custom_reader', args: { path: 'project/README.md' } },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const processor = {
      process: vi.fn(async (chunk: InternalLLMChunk, ctx: StreamContext) => {
        if (chunk.type === 'tool_call') {
          ctx.state.addToolCall({ id: chunk.callId, name: chunk.name, args: chunk.args });
        }
      }),
    } satisfies Pick<StreamProcessorService, 'process'>;
    const toolDispatch = {
      dispatch: vi.fn().mockResolvedValue({
        callId: 'call-1',
        status: 'success',
        data: { path: 'project/README.md' },
      }),
    } satisfies Pick<ToolDispatchService, 'dispatch'>;
    const auditEntries: Array<Parameters<AuditService['log']>[0]> = [];
    const audit = {
      log: vi.fn(async (entry: Parameters<AuditService['log']>[0]) => {
        auditEntries.push(entry);
        return 'audit-id';
      }),
      update: vi.fn(async () => undefined),
    } satisfies Pick<AuditService, 'log' | 'update'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      processor as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      toolDispatch as unknown as ToolDispatchService,
      audit as unknown as AuditService,
    );

    await runtime.runAgentLoop({
      runtimeKind: 'chat',
      sessionId: 'sid',
      turnId: 'turn-1',
      promptMessageId: 'user-1',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas,
      abortSignal: new AbortController().signal,
      emit: vi.fn() as EmitFn,
      maxIterations: 1,
    });

    expect(auditEntries.find((entry) => entry.type === 'tool_call')?.data).toMatchObject({
      domain: 'vfs',
      kind: 'file_tool_call',
      fileTool: {
        toolName: 'custom_reader',
        path: 'project/README.md',
      },
    });
    expect(auditEntries.find((entry) => entry.type === 'tool_result')?.data).toMatchObject({
      domain: 'vfs',
      kind: 'file_tool_result',
      fileTool: {
        toolName: 'custom_reader',
        path: 'project/README.md',
      },
    });
  });

  it('applies transformToolCall before emit, dispatch, and persistence', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'tool_call', callId: 'call-1', name: 'run_raapp', args: { id: 'wrong-id' } },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const processor = {
      process: vi.fn(async (chunk: InternalLLMChunk, ctx: StreamContext) => {
        if (chunk.type === 'tool_call') {
          ctx.state.addToolCall({ id: chunk.callId, name: chunk.name, args: chunk.args });
        }
      }),
    } satisfies Pick<StreamProcessorService, 'process'>;
    const toolDispatch = {
      dispatch: vi.fn().mockResolvedValue({ callId: 'call-1', status: 'success', data: { ok: true } }),
    } satisfies Pick<ToolDispatchService, 'dispatch'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      processor as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      toolDispatch as unknown as ToolDispatchService,
    );
    const emit = vi.fn() as EmitFn;

    await runtime.runAgentLoop({
      runtimeKind: 'chat',
      sessionId: 'sid',
      turnId: 'turn-1',
      promptMessageId: 'user-1',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas: [],
      abortSignal: new AbortController().signal,
      emit,
      maxIterations: 1,
      transformToolCall: (toolCall) => ({
        ...toolCall,
        args: { ...toolCall.args, id: 'right-id' },
      }),
    });

    expect(emit).toHaveBeenCalledWith('tool:start', expect.objectContaining({
      toolName: 'run_raapp',
      args: { id: 'right-id' },
    }));
    expect(toolDispatch.dispatch).toHaveBeenCalledWith(
      'call-1',
      'run_raapp',
      { id: 'right-id' },
      expect.any(Object),
      [],
    );
    expect(sessionManager.saveToolResult).toHaveBeenCalledWith(
      'sid',
      'call-1',
      JSON.stringify({ ok: true }),
      { turnId: 'turn-1', promptMessageId: 'user-1' },
    );
  });

  it('loads branch history from an explicit historySessionId when provided', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'text_delta', delta: 'branch answer' },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      {
        process: vi.fn(async (chunk: InternalLLMChunk, ctx: { state: { appendText: (delta: string) => void } }) => {
          if (chunk.type === 'text_delta') ctx.state.appendText(chunk.delta);
        }),
      } as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      { dispatch: vi.fn() } as unknown as ToolDispatchService,
    );

    await runtime.runAgentLoop({
      runtimeKind: 'agent-flow-branch',
      sessionId: 'branch-session',
      historySessionId: 'host-session',
      turnId: 'turn-2',
      promptMessageId: 'user-2',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas: [],
      abortSignal: new AbortController().signal,
      emit: vi.fn() as EmitFn,
      maxIterations: 2,
    });

    expect(sessionManager.loadHistoryForLLM).toHaveBeenCalledWith('branch-session', {
      systemPrompt: 'prompt',
      toolMetas: [],
      historySessionId: 'host-session',
    });
  });
});
