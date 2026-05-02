import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { SessionPipelineService } from '../session-pipeline.service';
import { ChatService } from '../chat.service';
import type { SocketEvents } from '@kalio/types';
import type { EmitFn } from '../interfaces/stream-context.interface';
import type { ILLMSource } from '../interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';
import { StreamProcessorService } from '../stream-processor.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { SessionManagerService } from '../session-manager.service';
import { AuditService } from '../audit.service';
import { PersonaService } from '../../persona/persona.service';
import { LLM_SOURCE, CHUNK_HANDLERS, STREAM_MIDDLEWARES, TOOL_REGISTRY } from '../chat.tokens';
import { SkillsService } from '../../skills/skills.service';

// ============================================================================
// ISSUE 1: Race condition in interrupt handling
// ============================================================================

type ChatSendPayload = SocketEvents['chat:send'];

/** Drain all pending microtasks/macrotasks so the mutex chain can settle. */
const flush = () => new Promise<void>((r) => setImmediate(r));

/**
 * Build a fake ChatService whose handleTurn() blocks on a manually-resolved
 * promise so we can deterministically test queueing/interrupt semantics.
 */
function makeBlockingChatService(): {
  chat: Pick<ChatService, 'handleTurn' | 'abort'>;
  release: (sessionId: string) => void;
  releaseAll: () => Promise<void>;
  callsReceived: Array<{ sessionId: string; content: string; personaId: string }>;
} {
  const callsReceived: Array<{ sessionId: string; content: string; personaId: string }> = [];
  const releasers = new Map<string, () => void>();
  const releaseQueue: Array<() => void> = [];

  const handleTurn = vi.fn().mockImplementation(
    async (sessionId: string, content: string, personaId: string, emit: EmitFn): Promise<void> => {
      callsReceived.push({ sessionId, content, personaId });
      emit('agent:start', { sessionId, turnId: `turn-${callsReceived.length}` });
      await new Promise<void>((resolve) => {
        releaseQueue.push(resolve);
        releasers.set(sessionId, resolve);
      });
      emit('chat:complete', { sessionId, messageId: `msg-${callsReceived.length}` });
      emit('agent:done', { sessionId, turnId: `turn-${callsReceived.length}` });
    },
  );

  const abort = vi.fn();

  return {
    chat: { handleTurn, abort } as unknown as Pick<ChatService, 'handleTurn' | 'abort'>,
    release: (sid: string) => {
      const fn = releasers.get(sid);
      if (fn) {
        releasers.delete(sid);
        fn();
      } else {
        const next = releaseQueue.shift();
        next?.();
      }
    },
    releaseAll: async () => {
      while (releaseQueue.length > 0) {
        const fn = releaseQueue.shift()!;
        fn();
        await new Promise((r) => setImmediate(r));
      }
      releasers.clear();
    },
    callsReceived,
  };
}

function makeEmit(): { emit: EmitFn; events: Array<{ event: string; data: unknown }> } {
  const events: Array<{ event: string; data: unknown }> = [];
  const emit: EmitFn = (event, data) => {
    events.push({ event: event as string, data });
  };
  return { emit, events };
}

const basePayload = (sid: string, content: string, interrupt = false): ChatSendPayload => ({
  sessionId: sid,
  content,
  personaId: 'p1',
  ...(interrupt ? { interrupt: true } : {}),
});

describe('ISSUE 1: Interrupt race condition', () => {
  let svc: SessionPipelineService;
  let chatHarness: ReturnType<typeof makeBlockingChatService>;

  beforeEach(() => {
    chatHarness = makeBlockingChatService();
    svc = new SessionPipelineService(chatHarness.chat as ChatService);
  });

  /**
   * This test verifies the race condition where a concurrent submit during
   * interrupt handling could observe the session as idle and start parallel
   * execution instead of enqueuing.
   *
   * EXPECTED BEHAVIOR: The third message ('sneaky') should be queued and
   * executed AFTER the interrupt completes, not in parallel.
   *
   * BUG: Without proper synchronization, 'sneaky' might start executing
   * concurrently with 'interrupt', violating session serialization.
   */
  it('should serialize concurrent submit during interrupt (race condition guard)', async () => {
    const { emit } = makeEmit();

    // Start first turn
    const p1 = svc.submit(basePayload('s1', 'first'), emit);
    await flush();
    expect(chatHarness.callsReceived).toHaveLength(1);
    expect(chatHarness.callsReceived[0].content).toBe('first');

    // Fire interrupt and IMMEDIATELY submit another message without awaiting
    // This simulates the race condition window
    const p2 = svc.submit(basePayload('s1', 'interrupt', true), emit);
    const p3 = svc.submit(basePayload('s1', 'sneaky'), emit);

    await flush();

    // At this point, if there's a race:
    // - 'interrupt' aborts the first turn
    // - 'sneaky' might observe session as idle (before interrupt re-claims slot)
    //   and start executing immediately = BUG

    // Release all pending turns
    await chatHarness.releaseAll();
    await Promise.all([p1, p2, p3]);

    const contents = chatHarness.callsReceived.map(c => c.content);

    // Verify: All three should execute in order
    expect(contents).toEqual(['first', 'interrupt', 'sneaky']);

    // Verify: No parallel execution (only one turn at a time per session)
    // We verify this by checking that 'interrupt' ran before 'sneaky'
    const interruptIndex = contents.indexOf('interrupt');
    const sneakyIndex = contents.indexOf('sneaky');
    expect(sneakyIndex).toBeGreaterThan(interruptIndex);
  });

  /**
   * Stress test: Rapidly alternate interrupts and regular messages
   * to expose any race window.
   */
  it('should handle rapid interrupt alternation without races', async () => {
    const { emit } = makeEmit();
    const promises: Promise<void>[] = [];

    // Fire alternating interrupt/regular messages rapidly
    for (let i = 0; i < 5; i++) {
      promises.push(svc.submit(basePayload('s1', `msg-${i}`), emit));
      promises.push(svc.submit(basePayload('s1', `int-${i}`, true), emit));
    }

    await flush();
    await chatHarness.releaseAll();
    await Promise.all(promises);

    // Verify: All 10 messages processed
    expect(chatHarness.callsReceived).toHaveLength(10);

    // Verify: No duplicates (race could cause double-execution)
    const contents = chatHarness.callsReceived.map(c => c.content);
    const uniqueContents = [...new Set(contents)];
    expect(uniqueContents).toHaveLength(contents.length);
  });
});

// ============================================================================
// ISSUE 2: MAX_ITERATIONS behavior verification
// ============================================================================

function makeFiniteToolStream(): ILLMSource {
  return {
    stream: vi.fn().mockImplementation(async function* () {
      yield { type: 'tool_call', callId: 'tc-1', name: 'test_tool', args: {} };
      yield { type: 'done' };
    }),
  };
}

describe('ISSUE 2: MAX_ITERATIONS behavior', () => {
  let chatService: ChatService;
  let events: Array<{ event: string; data: unknown }>;
  let emit: EmitFn;

  beforeEach(async () => {
    events = [];
    emit = (event, data) => {
      events.push({ event: event as string, data });
    };

    const llmSource = makeFiniteToolStream();

    // Mock streamProcessor to populate state.toolCalls so loop continues
    const mockStreamProcessor = {
      process: vi.fn().mockImplementation(async (chunk: InternalLLMChunk, ctx: any) => {
        if (chunk.type === 'tool_call') {
          ctx.state.toolCalls.push({ id: chunk.callId, name: chunk.name, args: chunk.args });
        }
      }),
      onModuleInit: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: StreamProcessorService, useValue: mockStreamProcessor },
        {
          provide: SessionManagerService,
          useValue: {
            ensureSession: vi.fn().mockResolvedValue(undefined),
            persistUserMessage: vi.fn().mockResolvedValue(undefined),
            loadHistory: vi.fn().mockResolvedValue([]),
            saveToolResult: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ToolDispatchService,
          useValue: {
            getToolMetas: vi.fn().mockReturnValue([]),
            dispatch: vi.fn().mockResolvedValue({ status: 'success', data: {} }),
          },
        },
        {
          provide: PersonaService,
          useValue: {
            getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', allowedTools: [], skillIds: [], kv: {} }),
          },
        },
        {
          provide: SkillsService,
          useValue: {
            findByIds: vi.fn().mockResolvedValue([]),
          },
        },
        { provide: AuditService, useValue: { log: vi.fn().mockResolvedValue('audit-id'), update: vi.fn().mockResolvedValue(undefined) } },
        { provide: LLM_SOURCE, useValue: llmSource },
        { provide: CHUNK_HANDLERS, useValue: [] },
        { provide: STREAM_MIDDLEWARES, useValue: [] },
        { provide: TOOL_REGISTRY, useValue: [] },
      ],
    }).compile();

    chatService = moduleRef.get(ChatService);
  });

  it('emits MAX_ITERATIONS_REACHED when loop limit exceeded', async () => {
    await chatService.handleTurn('s1', 'test', 'p1', emit);

    const errorEvents = events.filter(e => e.event === 'chat:error');
    const maxIterationsError = errorEvents.find(
      e => (e.data as any).code === 'MAX_ITERATIONS_REACHED'
    );

    expect(maxIterationsError).toBeDefined();
    expect(maxIterationsError?.data).toMatchObject({
      sessionId: 's1',
      code: 'MAX_ITERATIONS_REACHED',
      message: expect.stringContaining('8'),
    });
  });
});
