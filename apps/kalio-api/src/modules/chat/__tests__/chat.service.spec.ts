import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ChatService } from '../chat.service';
import { StreamProcessorService } from '../stream-processor.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { SessionManagerService } from '../session-manager.service';
import { AuditService } from '../audit.service';
import { TurnErrorAlreadyEmitted } from '../turn-error';
import { LLM_SOURCE, CHUNK_HANDLERS, STREAM_MIDDLEWARES, TOOL_REGISTRY } from '../chat.tokens';
import type { ILLMSource, LLMSourceParams } from '../interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';
import type { EmitFn } from '../interfaces/stream-context.interface';
import type { LLMMessage } from '@kalio/types';
import { PersonaService } from '../../persona/persona.service';
import { SkillsService } from '../../skills/skills.service';
import { CredentialsService } from '../../credentials/credentials.service';

async function* makeStream(chunks: InternalLLMChunk[]): AsyncIterable<InternalLLMChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function makeLLMSource(chunks: InternalLLMChunk[]): ILLMSource {
  return { stream: vi.fn().mockReturnValue(makeStream(chunks)) };
}

describe('ChatService', () => {
  let service: ChatService;
  let sessionManager: {
    ensureSession: ReturnType<typeof vi.fn>;
    persistUserMessage: ReturnType<typeof vi.fn>;
    persistAssistantMessage: ReturnType<typeof vi.fn>;
    saveToolResult: ReturnType<typeof vi.fn>;
    loadHistory: ReturnType<typeof vi.fn>;
  };
  let toolDispatch: { getToolMetas: ReturnType<typeof vi.fn>; dispatch: ReturnType<typeof vi.fn> };
  let personaService: Partial<PersonaService>;
  let credentialsService: Pick<CredentialsService, 'getMaxToolAttempts' | 'getContextWindowSize'>;
  let auditService: Partial<AuditService>;
  let emit: ReturnType<typeof vi.fn>;

  const historyMessages: LLMMessage[] = [];

  beforeEach(async () => {
    emit = vi.fn() as ReturnType<typeof vi.fn>;
    historyMessages.length = 0;
    sessionManager = {
      ensureSession: vi.fn().mockResolvedValue(undefined),
      persistUserMessage: vi.fn().mockResolvedValue({ id: 'u1', sessionId: 'sid', role: 'user', content: 'hi', createdAt: 1 }),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue(historyMessages),
    };
    toolDispatch = {
      getToolMetas: vi.fn().mockReturnValue([]),
      dispatch: vi.fn().mockResolvedValue({ callId: 'c', status: 'success', data: {} }),
    };
    personaService = {
      getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }),
    };
    credentialsService = {
      getMaxToolAttempts: vi.fn().mockResolvedValue(8),
      getContextWindowSize: vi.fn().mockResolvedValue(32000),
    };
    auditService = {
      log: vi.fn().mockResolvedValue('audit-id'),
      update: vi.fn().mockResolvedValue(undefined),
    };
  });

  async function buildService(llmSource: ILLMSource): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: StreamProcessorService,
          useValue: {
            process: vi.fn().mockImplementation(async (chunk: InternalLLMChunk, ctx: { state: { appendText: (delta: string) => void; addToolCall: (toolCall: { id: string; name: string; args: object }) => void }; emit: EmitFn; sessionId: string; messageId: string }) => {
              if (chunk.type === 'text_delta') {
                ctx.state.appendText(chunk.delta);
                ctx.emit('chat:chunk', {
                  sessionId: ctx.sessionId,
                  messageId: ctx.messageId,
                  delta: chunk.delta,
                  done: false,
                });
                return;
              }

              if (chunk.type === 'tool_call') {
                ctx.state.addToolCall({ id: chunk.callId, name: chunk.name, args: chunk.args });
              }
            }),
            onModuleInit: vi.fn(),
          },
        },
        { provide: SessionManagerService, useValue: sessionManager },
        { provide: ToolDispatchService, useValue: toolDispatch },
        { provide: PersonaService, useValue: personaService },
        { provide: SkillsService, useValue: { findByIds: vi.fn().mockResolvedValue([]) } },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: AuditService, useValue: auditService },
        { provide: LLM_SOURCE, useValue: llmSource },
        // Unused in this test but required by processors
        { provide: CHUNK_HANDLERS, useValue: [] },
        { provide: STREAM_MIDDLEWARES, useValue: [] },
        { provide: TOOL_REGISTRY, useValue: [] },
      ],
    }).compile();

    service = moduleRef.get(ChatService);
  }

  it('persists user message before streaming', async () => {
    const llmSource = makeLLMSource([]);
    await buildService(llmSource);
    await service.handleTurn('sid', 'hello', 'persona-1', emit as EmitFn);
    expect(sessionManager.persistUserMessage).toHaveBeenCalledWith('sid', 'hello', undefined);
  });

  it('forwards attachments to persistUserMessage', async () => {
    const llmSource = makeLLMSource([]);
    await buildService(llmSource);
    const attachments = [{ path: 'uploads/a.png', mimeType: 'image/png' }];
    await service.handleTurn('sid', 'see', 'p1', emit as EmitFn, attachments);
    expect(sessionManager.persistUserMessage).toHaveBeenCalledWith('sid', 'see', attachments);
  });

  it('emits chat:context with tool names before streaming', async () => {
    toolDispatch.getToolMetas.mockReturnValue([
      { name: 'tool_a', description: '', parameters: {}, requiresConfirmation: false },
    ]);
    const llmSource = makeLLMSource([]);
    await buildService(llmSource);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);
    expect(emit).toHaveBeenCalledWith('chat:context', expect.objectContaining({ toolNames: ['tool_a'] }));
  });

  it('calls llmSource.stream with messages and tools', async () => {
    const llmSource = makeLLMSource([]);
    await buildService(llmSource);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);
    expect(llmSource.stream).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sid' }),
    );
  });

  it('REGRESSION: compacts history server-side against the configured context window before streaming', async () => {
    historyMessages.push(
      { role: 'user', content: 'first user stays' },
      {
        role: 'assistant',
        content: 'calling image tool',
        toolCalls: [{ id: 'call-1', name: 'image_generate', args: { prompt: 'cat' } }],
      },
      { role: 'tool', toolCallId: 'call-1', content: 'x'.repeat(6_000) },
      { role: 'assistant', content: 'older assistant reply' },
      { role: 'user', content: 'latest user prompt' },
    );
    credentialsService.getContextWindowSize.mockResolvedValue(200);

    const llmSource = makeLLMSource([]);
    await buildService(llmSource);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);

    const params = (llmSource.stream as ReturnType<typeof vi.fn>).mock.calls[0][0] as LLMSourceParams;

    expect(params.messages.some((message) => message.role === 'tool' && message.toolCallId === 'call-1')).toBe(false);
    expect(params.messages.some((message) => message.role === 'assistant' && message.toolCalls?.some((toolCall) => toolCall.id === 'call-1'))).toBe(false);
    expect(params.messages.some((message) => message.role === 'user' && message.content === 'first user stays')).toBe(true);
  });

  it('processes each chunk via StreamProcessorService', async () => {
    const chunks: InternalLLMChunk[] = [
      { type: 'text_delta', delta: 'hello' },
      { type: 'done' },
    ];
    const llmSource = makeLLMSource(chunks);
    await buildService(llmSource);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);
    expect(llmSource.stream).toHaveBeenCalled();
  });

  it('emits chat:error and does not re-throw on LLM error (non-stream error)', async () => {
    const failSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => { throw new Error('LLM unavailable'); }),
    };
    await buildService(failSource);
    await expect(service.handleTurn('sid', 'q', 'p1', emit as EmitFn)).resolves.toBeUndefined();
    expect(emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({ sessionId: 'sid' }));
  });

  it('does not double-emit chat:error when errorBoundaryMiddleware already emitted', async () => {
    const alreadyEmittedSource: ILLMSource = {
      stream: vi.fn().mockImplementation(async function* (_params: LLMSourceParams) {
        throw new TurnErrorAlreadyEmitted(new Error('already handled'));
      }),
    };
    await buildService(alreadyEmittedSource);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);
    const errorEmits = (emit as ReturnType<typeof vi.fn>).mock.calls.filter((args: unknown[]) => args[0] === 'chat:error');
    expect(errorEmits).toHaveLength(0);
  });

  it('abort does not throw for unknown session', async () => {
    const llmSource = makeLLMSource([]);
    await buildService(llmSource);
    expect(() => service.abort('non-existing-session')).not.toThrow();
  });

  it('emits agent:start BEFORE first chunk and agent:done at end (FE bubble lifecycle)', async () => {
    const llmSource = makeLLMSource([{ type: 'text_delta', delta: 'hi' }, { type: 'done' }]);
    await buildService(llmSource);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);

    const events = (emit as ReturnType<typeof vi.fn>).mock.calls.map((args: unknown[]) => args[0] as string);
    const startIdx = events.indexOf('agent:start');
    const doneIdx = events.lastIndexOf('agent:done');
    const completeIdx = events.indexOf('chat:complete');

    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(startIdx);
    expect(completeIdx).toBeGreaterThan(startIdx);
    // agent:start must come before chat:context so the FE can open the turn before any chunks
    expect(startIdx).toBeLessThan(events.indexOf('chat:context'));
  });

  it('emits agent:done even when the turn fails (no orphan bubbles)', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => {
        throw new Error('LLM down');
      }),
    };
    await buildService(llmSource);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);

    const events = (emit as ReturnType<typeof vi.fn>).mock.calls.map((args: unknown[]) => args[0] as string);
    expect(events).toContain('agent:done');
    expect(events).toContain('chat:error');
  });

  it('emits chat:complete exactly once at end of agent loop', async () => {
    const llmSource = makeLLMSource([{ type: 'text_delta', delta: 'done' }, { type: 'done' }]);
    await buildService(llmSource);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);
    const completeCalls = (emit as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === 'chat:complete',
    );
    expect(completeCalls).toHaveLength(1);
  });

  it('iterates LLM call when tool calls were emitted, then stops on text-only iteration', async () => {
    // Each call to stream() yields a single 'done' chunk, but we start a fresh stream per iteration.
    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => makeStream([{ type: 'done' }])),
    };

    const processor = {
      // First iteration requests a tool, second produces the final assistant text.
      process: vi.fn().mockImplementation(async (_chunk: unknown, ctx: { state: { addToolCall: (tc: unknown) => void; text: string } }) => {
        if ((processor.process as ReturnType<typeof vi.fn>).mock.calls.length === 1) {
          ctx.state.addToolCall({ id: 'c1', name: 't', args: {} });
          return;
        }

        ctx.state.text = 'final answer';
      }),
      onModuleInit: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: StreamProcessorService, useValue: processor },
        { provide: SessionManagerService, useValue: sessionManager },
        { provide: ToolDispatchService, useValue: toolDispatch },
        { provide: PersonaService, useValue: personaService },
        { provide: SkillsService, useValue: { findByIds: vi.fn().mockResolvedValue([]) } },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: AuditService, useValue: auditService },
        { provide: LLM_SOURCE, useValue: llmSource },
        { provide: CHUNK_HANDLERS, useValue: [] },
        { provide: STREAM_MIDDLEWARES, useValue: [] },
        { provide: TOOL_REGISTRY, useValue: [] },
      ],
    }).compile();
    service = moduleRef.get(ChatService);

    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);

    expect(llmSource.stream).toHaveBeenCalledTimes(2);
    const completeCalls = (emit as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === 'chat:complete',
    );
    expect(completeCalls).toHaveLength(1);
  });

  it('abort clears the controller after a completed turn', async () => {
    const llmSource = makeLLMSource([]);
    await buildService(llmSource);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);
    // After the turn finishes, the controller should be cleaned up; calling abort is a no-op
    expect(() => service.abort('sid')).not.toThrow();
  });

  it('keeps the newer controller when overlapping turns share a session id', async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let streamCallCount = 0;

    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(async function* (params: LLMSourceParams) {
        const callIndex = ++streamCallCount;
        yield { type: 'text_delta', delta: callIndex === 1 ? 'first' : 'second' };

        if (callIndex === 1) {
          await firstGate;
          yield { type: 'done' };
          return;
        }

        const outcome = await Promise.race([
          secondGate.then(() => 'released' as const),
          new Promise<'aborted'>((resolve) => {
            params.abortSignal?.addEventListener('abort', () => resolve('aborted'), { once: true });
          }),
        ]);

        if (outcome === 'released') {
          yield { type: 'done' };
        }
      }),
    };

    await buildService(llmSource);

    const firstTurn = service.handleTurn('sid', 'first', 'p1', emit as EmitFn);
    await Promise.resolve();

    const secondTurn = service.handleTurn('sid', 'second', 'p1', emit as EmitFn);
    await Promise.resolve();

    releaseFirst();
    await firstTurn;

    const controllers = (service as unknown as { abortControllers: Map<string, AbortController> }).abortControllers;

    try {
      expect(controllers.has('sid')).toBe(true);
    } finally {
      if (controllers.has('sid')) {
        service.abort('sid');
      } else {
        releaseSecond();
      }
      await secondTurn;
    }
  });

  // ─── hadContent tracking ────────────────────────────────────────────────────

  it('emits hadContent=false when LLM throws before any chunk (early LLM_ERROR)', async () => {
    const failSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => { throw new Error('LLM unavailable'); }),
    };
    await buildService(failSource);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);
    const errorCall = (emit as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => args[0] === 'chat:error',
    );
    expect(errorCall).toBeDefined();
    expect(errorCall![1]).toMatchObject({ hadContent: false });
  });

  it('emits hadContent=false when abort happens before any chat:chunk', async () => {
    // LLM source that signals abort before yielding any chunk
    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(async function* () {
        // Yield nothing — abort fires from the outside
      }),
    };
    await buildService(llmSource);
    // Start the turn, then abort synchronously
    const promise = service.handleTurn('sid', 'q', 'p1', emit as EmitFn);
    service.abort('sid');
    await promise;
    const errorCall = (emit as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => args[0] === 'chat:error',
    );
    expect(errorCall).toBeDefined();
    expect(errorCall![1]).toMatchObject({ code: 'INTERRUPTED', hadContent: false });
  });

  it('emits hadContent=true when abort happens after at least one chat:chunk', async () => {
    // We need a StreamProcessorService that emits a chat:chunk and THEN aborts.
    // Calling service.abort() before the promise starts would race and
    // potentially abort before any chunk, keeping hadContent=false.
    let capturedService: typeof service;
    const chunks: InternalLLMChunk[] = [{ type: 'text_delta', delta: 'hello' }, { type: 'done' }];
    const llmSource = makeLLMSource(chunks);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: StreamProcessorService,
          useValue: {
            process: vi.fn().mockImplementation(async (_chunk: unknown, ctx: { emit: EmitFn; sessionId: string; messageId: string }) => {
              // Emit chat:chunk first (sets hadContent=true), then abort
              ctx.emit('chat:chunk', { sessionId: ctx.sessionId, messageId: ctx.messageId, delta: 'hi', done: false });
              capturedService.abort(ctx.sessionId);
            }),
            onModuleInit: vi.fn(),
          },
        },
        { provide: SessionManagerService, useValue: sessionManager },
        { provide: ToolDispatchService, useValue: toolDispatch },
        { provide: PersonaService, useValue: personaService },
        { provide: SkillsService, useValue: { findByIds: vi.fn().mockResolvedValue([]) } },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: AuditService, useValue: auditService },
        { provide: LLM_SOURCE, useValue: llmSource },
        { provide: CHUNK_HANDLERS, useValue: [] },
        { provide: STREAM_MIDDLEWARES, useValue: [] },
        { provide: TOOL_REGISTRY, useValue: [] },
      ],
    }).compile();
    capturedService = moduleRef.get(ChatService);

    await capturedService.handleTurn('sid', 'q', 'p1', emit as EmitFn);

    const errorCall = (emit as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => args[0] === 'chat:error',
    );
    expect(errorCall).toBeDefined();
    expect(errorCall![1]).toMatchObject({ code: 'INTERRUPTED', hadContent: true });
  });

  // ─── MAX_ITERATIONS ─────────────────────────────────────────────────────────

  it('MAX_ITERATIONS: emits chat:error not chat:complete', async () => {
    // Every iteration always produces a tool call so the loop never exits normally
    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => makeStream([{ type: 'done' }])),
    };
    const processor = {
      process: vi.fn().mockImplementation(async (_chunk: unknown, ctx: { state: { addToolCall: (tc: unknown) => void } }) => {
        ctx.state.addToolCall({ id: `c${Date.now()}`, name: 'tool_a', args: {} });
      }),
      onModuleInit: vi.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: StreamProcessorService, useValue: processor },
        { provide: SessionManagerService, useValue: sessionManager },
        { provide: ToolDispatchService, useValue: toolDispatch },
        { provide: PersonaService, useValue: personaService },
        { provide: SkillsService, useValue: { findByIds: vi.fn().mockResolvedValue([]) } },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: AuditService, useValue: auditService },
        { provide: LLM_SOURCE, useValue: llmSource },
        { provide: CHUNK_HANDLERS, useValue: [] },
        { provide: STREAM_MIDDLEWARES, useValue: [] },
        { provide: TOOL_REGISTRY, useValue: [] },
      ],
    }).compile();
    service = moduleRef.get(ChatService);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);

    const completeCalls = (emit as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === 'chat:complete',
    );
    const errorCalls = (emit as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === 'chat:error',
    );
    expect(completeCalls).toHaveLength(0);
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1]).toMatchObject({ code: 'MAX_ITERATIONS_REACHED' });
  });

  it('MAX_ITERATIONS: always emits agent:done', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => makeStream([{ type: 'done' }])),
    };
    const processor = {
      process: vi.fn().mockImplementation(async (_chunk: unknown, ctx: { state: { addToolCall: (tc: unknown) => void } }) => {
        ctx.state.addToolCall({ id: `c${Date.now()}`, name: 'tool_a', args: {} });
      }),
      onModuleInit: vi.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: StreamProcessorService, useValue: processor },
        { provide: SessionManagerService, useValue: sessionManager },
        { provide: ToolDispatchService, useValue: toolDispatch },
        { provide: PersonaService, useValue: personaService },
        { provide: SkillsService, useValue: { findByIds: vi.fn().mockResolvedValue([]) } },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: AuditService, useValue: auditService },
        { provide: LLM_SOURCE, useValue: llmSource },
        { provide: CHUNK_HANDLERS, useValue: [] },
        { provide: STREAM_MIDDLEWARES, useValue: [] },
        { provide: TOOL_REGISTRY, useValue: [] },
      ],
    }).compile();
    service = moduleRef.get(ChatService);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);

    const doneCalls = (emit as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === 'agent:done',
    );
    expect(doneCalls).toHaveLength(1);
  });

  // ─── Audit: tool_call / tool_result logging ─────────────────────────────────

  it('logs tool_call and tool_result to audit when a tool is dispatched', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => makeStream([{ type: 'done' }])),
    };
    const processor = {
      // First iteration adds one tool call; second iteration is clean.
      process: vi.fn().mockImplementation(async (_chunk: unknown, ctx: { state: { addToolCall: (tc: unknown) => void } }) => {
        if ((processor.process as ReturnType<typeof vi.fn>).mock.calls.length === 1) {
          ctx.state.addToolCall({ id: 'tc1', name: 'my_tool', args: { x: 1 } });
        }
      }),
      onModuleInit: vi.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: StreamProcessorService, useValue: processor },
        { provide: SessionManagerService, useValue: sessionManager },
        { provide: ToolDispatchService, useValue: toolDispatch },
        { provide: PersonaService, useValue: personaService },
        { provide: SkillsService, useValue: { findByIds: vi.fn().mockResolvedValue([]) } },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: AuditService, useValue: auditService },
        { provide: LLM_SOURCE, useValue: llmSource },
        { provide: CHUNK_HANDLERS, useValue: [] },
        { provide: STREAM_MIDDLEWARES, useValue: [] },
        { provide: TOOL_REGISTRY, useValue: [] },
      ],
    }).compile();
    service = moduleRef.get(ChatService);

    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);

    const logCalls = (auditService.log as ReturnType<typeof vi.fn>).mock.calls as Array<[unknown]>;
    const toolCallLog = logCalls.find((args) => (args[0] as { type: string }).type === 'tool_call');
    const toolResultLog = logCalls.find((args) => (args[0] as { type: string }).type === 'tool_result');

    expect(toolCallLog).toBeDefined();
    expect(toolCallLog![0]).toMatchObject({ type: 'tool_call', label: 'my_tool', data: { callId: 'tc1' } });

    expect(toolResultLog).toBeDefined();
    expect(toolResultLog![0]).toMatchObject({ type: 'tool_result', label: 'my_tool', data: { callId: 'tc1', status: 'success' } });
  });

  it('logs chunkCount via audit.update after streaming completes', async () => {
    const chunks: InternalLLMChunk[] = [
      { type: 'text_delta', delta: 'a' },
      { type: 'text_delta', delta: 'b' },
      { type: 'done' },
    ];
    const llmSource = makeLLMSource(chunks);
    await buildService(llmSource);
    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);

    const updateCalls = (auditService.update as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
    // There must be at least one final update with chunkCount = 3 (3 chunks were yielded)
    const finalUpdate = updateCalls.find(
      (args) => typeof (args[1] as { chunkCount?: number }).chunkCount === 'number',
    );
    expect(finalUpdate).toBeDefined();
    expect((finalUpdate![1] as { chunkCount: number }).chunkCount).toBe(3);
  });
});
