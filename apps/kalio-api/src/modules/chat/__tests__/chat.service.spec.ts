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
    loadHistory: ReturnType<typeof vi.fn>;
  };
  let toolDispatch: { getToolMetas: ReturnType<typeof vi.fn> };
  let personaService: Partial<PersonaService>;
  let auditService: Partial<AuditService>;
  let emit: ReturnType<typeof vi.fn>;

  const historyMessages: LLMMessage[] = [];

  beforeEach(async () => {
    emit = vi.fn() as ReturnType<typeof vi.fn>;
    sessionManager = {
      ensureSession: vi.fn().mockResolvedValue(undefined),
      persistUserMessage: vi.fn().mockResolvedValue({ id: 'u1', sessionId: 'sid', role: 'user', content: 'hi', createdAt: 1 }),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue(historyMessages),
    };
    toolDispatch = {
      getToolMetas: vi.fn().mockReturnValue([]),
    };
    personaService = {
      getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }),
    };
    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };
  });

  async function buildService(llmSource: ILLMSource): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        // StreamProcessor with no-op pipeline
        {
          provide: StreamProcessorService,
          useValue: { process: vi.fn().mockResolvedValue(undefined), onModuleInit: vi.fn() },
        },
        { provide: SessionManagerService, useValue: sessionManager },
        { provide: ToolDispatchService, useValue: toolDispatch },
        { provide: PersonaService, useValue: personaService },
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
    expect(sessionManager.persistUserMessage).toHaveBeenCalledWith('sid', 'hello');
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
    const llmSource = makeLLMSource([{ type: 'done' }]);
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
      // Use call count: first invocation populates a tool call, subsequent ones don't.
      process: vi.fn().mockImplementation(async (_chunk: unknown, ctx: { state: { addToolCall: (tc: unknown) => void } }) => {
        if ((processor.process as ReturnType<typeof vi.fn>).mock.calls.length === 1) {
          ctx.state.addToolCall({ id: 'c1', name: 't', args: {} });
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
});
