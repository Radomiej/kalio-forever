import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ChatService } from '../chat.service';
import { StreamProcessorService } from '../stream-processor.service';
import { SessionManagerService } from '../session-manager.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { AuditService } from '../audit.service';
import { PersonaService } from '../../persona/persona.service';
import { LLM_SOURCE, CHUNK_HANDLERS, STREAM_MIDDLEWARES, TOOL_REGISTRY } from '../chat.tokens';
import { TextDeltaHandler } from '../handlers/text-delta.handler';
import { ThinkingDeltaHandler } from '../handlers/thinking-delta.handler';
import { ToolCallHandler } from '../handlers/tool-call.handler';
import { DoneHandler } from '../handlers/done.handler';
import type { ILLMSource } from '../interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';
import type { EmitFn } from '../interfaces/stream-context.interface';
import type { ChatMessage } from '@kalio/types';

/**
 * Integration-level ordering tests.
 *
 * These specs assert the public event sequence emitted to the FE for
 * realistic conversational scenarios. They are deliberately black-box:
 * we wire the real StreamProcessor, real handlers and a fake LLM source,
 * then assert the order of emitted Socket.IO events.
 *
 * If any of these flake, the live chat bubble in the browser will be
 * out of order — these are the regression tripwires.
 */

async function* makeStream(chunks: InternalLLMChunk[]): AsyncGenerator<InternalLLMChunk> {
  for (const c of chunks) yield c;
}

interface ToolDispatchMock {
  getToolMetas: ReturnType<typeof vi.fn>;
  dispatch: ReturnType<typeof vi.fn>;
}

interface SessionManagerMock {
  ensureSession: ReturnType<typeof vi.fn>;
  persistUserMessage: ReturnType<typeof vi.fn>;
  persistAssistantMessage: ReturnType<typeof vi.fn>;
  saveToolResult?: ReturnType<typeof vi.fn>;
  loadHistory: ReturnType<typeof vi.fn>;
}

async function buildService(
  llmSource: ILLMSource,
  sessionManager: SessionManagerMock,
  toolDispatch: ToolDispatchMock,
): Promise<ChatService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ChatService,
      StreamProcessorService,
      TextDeltaHandler,
      ThinkingDeltaHandler,
      ToolCallHandler,
      DoneHandler,
      {
        provide: CHUNK_HANDLERS,
        useFactory: (text: TextDeltaHandler, thinking: ThinkingDeltaHandler, tool: ToolCallHandler, done: DoneHandler) =>
          [text, thinking, tool, done],
        inject: [TextDeltaHandler, ThinkingDeltaHandler, ToolCallHandler, DoneHandler],
      },
      { provide: STREAM_MIDDLEWARES, useValue: [] },
      { provide: SessionManagerService, useValue: sessionManager },
      { provide: ToolDispatchService, useValue: toolDispatch },
      {
        provide: PersonaService,
        useValue: {
          getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }),
        },
      },
      { provide: AuditService, useValue: { log: vi.fn().mockResolvedValue(undefined) } },
      { provide: LLM_SOURCE, useValue: llmSource },
      { provide: TOOL_REGISTRY, useValue: [] },
    ],
  }).compile();

  // StreamProcessorService.onModuleInit wires the chain; trigger it
  await moduleRef.init();
  return moduleRef.get(ChatService);
}

function captureEvents(emit: ReturnType<typeof vi.fn>): string[] {
  return emit.mock.calls.map((args: unknown[]) => args[0] as string);
}

describe('ChatService — event ordering (integration)', () => {
  let emit: ReturnType<typeof vi.fn>;
  let sessionManager: SessionManagerMock;
  let toolDispatch: ToolDispatchMock;
  let history: ChatMessage[];

  beforeEach(() => {
    emit = vi.fn();
    history = [];
    sessionManager = {
      ensureSession: vi.fn().mockResolvedValue(undefined),
      persistUserMessage: vi.fn().mockImplementation(async (sid: string, content: string) => {
        const msg: ChatMessage = { id: `u${history.length}`, sessionId: sid, role: 'user', content, createdAt: Date.now() };
        history.push(msg);
        return msg;
      }),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockImplementation(async () => [...history]),
    };
    toolDispatch = {
      getToolMetas: vi.fn().mockReturnValue([
        { name: 'list_raapps', description: '', parameters: {}, requiresConfirmation: false },
        { name: 'run_raapp', description: '', parameters: {}, requiresConfirmation: false },
      ]),
      // ChatService now owns tool:start/tool:result emission. Dispatch only executes the tool and returns a result.
      dispatch: vi.fn().mockImplementation(async (callId: string) => ({
        callId,
        status: 'success' as const,
        data: { ok: true },
      })),
    };
  });

  it('pure-text turn emits: agent:start → chat:context → chat:chunk* → chat:complete → agent:done', async () => {
    const chunks: InternalLLMChunk[] = [
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'done' },
    ];
    const llmSource: ILLMSource = { stream: vi.fn().mockImplementation(() => makeStream(chunks)) };
    const service = await buildService(llmSource, sessionManager, toolDispatch);

    await service.handleTurn('sid', 'hi', 'p1', emit as EmitFn);

    const events = captureEvents(emit);
    expect(events[0]).toBe('agent:start');
    expect(events[1]).toBe('chat:context');
    // All chat:chunks before chat:complete
    const completeIdx = events.indexOf('chat:complete');
    const chunkIdxs = events.map((e, i) => (e === 'chat:chunk' ? i : -1)).filter((i) => i >= 0);
    expect(chunkIdxs.length).toBeGreaterThan(0);
    chunkIdxs.forEach((idx) => expect(idx).toBeLessThan(completeIdx));
    expect(events[events.length - 1]).toBe('agent:done');
  });

  it('thinking precedes text within a single iteration', async () => {
    const chunks: InternalLLMChunk[] = [
      { type: 'thinking_delta', delta: 'Let me think...' },
      { type: 'thinking_delta', delta: ' about this.' },
      { type: 'text_delta', delta: 'The answer is 42.' },
      { type: 'done' },
    ];
    const llmSource: ILLMSource = { stream: vi.fn().mockImplementation(() => makeStream(chunks)) };
    const service = await buildService(llmSource, sessionManager, toolDispatch);

    await service.handleTurn('sid', 'q', 'p1', emit as EmitFn);

    // Project chat:chunk emissions to (thinking|text)
    const chunkKinds = emit.mock.calls
      .filter((args: unknown[]) => args[0] === 'chat:chunk')
      .map((args: unknown[]) => {
        const payload = args[1] as { thinking?: boolean };
        return payload.thinking ? 'thinking' : 'text';
      });
    // Every thinking comes before every text
    const lastThinking = chunkKinds.lastIndexOf('thinking');
    const firstText = chunkKinds.indexOf('text');
    expect(lastThinking).toBeGreaterThanOrEqual(0);
    expect(firstText).toBeGreaterThan(lastThinking);
  });

  it('tool turn: agent:start → context → tool:start → tool:result → text chunks → complete → done', async () => {
    let iter = 0;
    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => {
        iter++;
        if (iter === 1) {
          return makeStream([
            { type: 'thinking_delta', delta: 'Need data' },
            { type: 'tool_call', callId: 'c1', name: 'list_raapps', args: {} },
            { type: 'done' },
          ]);
        }
        // Second iteration: produce final text answer
        return makeStream([
          { type: 'text_delta', delta: 'Found 3 apps.' },
          { type: 'done' },
        ]);
      }),
    };
    const service = await buildService(llmSource, sessionManager, toolDispatch);

    await service.handleTurn('sid', 'list apps', 'p1', emit as EmitFn);

    const events = captureEvents(emit);
    const idx = (e: string) => events.indexOf(e);

    expect(idx('agent:start')).toBe(0);
    expect(idx('chat:context')).toBe(1);
    expect(idx('tool:start')).toBeGreaterThan(idx('chat:context'));
    expect(idx('tool:result')).toBeGreaterThan(idx('tool:start'));
    // Final text chunks come after the tool result (second iteration)
    const firstChunkAfterTool = events.findIndex((e, i) => e === 'chat:chunk' && i > idx('tool:result'));
    expect(firstChunkAfterTool).toBeGreaterThan(idx('tool:result'));
    expect(idx('chat:complete')).toBeGreaterThan(firstChunkAfterTool);
    expect(events.lastIndexOf('agent:done')).toBeGreaterThan(idx('chat:complete'));
    // Exactly one chat:complete and one agent:done per turn
    expect(events.filter((e) => e === 'chat:complete')).toHaveLength(1);
    expect(events.filter((e) => e === 'agent:done')).toHaveLength(1);
  });

  it('multi-turn dialog preserves agent:start/done bracketing per turn', async () => {
    // Each handleTurn invocation should produce its own agent:start..agent:done bracket
    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => makeStream([
        { type: 'text_delta', delta: 'ok' },
        { type: 'done' },
      ])),
    };
    const service = await buildService(llmSource, sessionManager, toolDispatch);

    await service.handleTurn('sid', 'first', 'p1', emit as EmitFn);
    await service.handleTurn('sid', 'second', 'p1', emit as EmitFn);
    await service.handleTurn('sid', 'third', 'p1', emit as EmitFn);

    const events = captureEvents(emit);

    // Verify bracketing: each agent:start has a matching agent:done after it,
    // with no overlapping turns.
    const starts = events.map((e, i) => (e === 'agent:start' ? i : -1)).filter((i) => i >= 0);
    const dones = events.map((e, i) => (e === 'agent:done' ? i : -1)).filter((i) => i >= 0);
    expect(starts).toHaveLength(3);
    expect(dones).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(dones[i]).toBeGreaterThan(starts[i]);
      if (i + 1 < 3) {
        expect(starts[i + 1]).toBeGreaterThan(dones[i]);
      }
    }
    // Each turn has exactly one chat:complete inside its bracket
    for (let i = 0; i < 3; i++) {
      const slice = events.slice(starts[i], dones[i] + 1);
      expect(slice.filter((e) => e === 'chat:complete')).toHaveLength(1);
    }
  });

  it('aborted turn emits chat:error INTERRUPTED before agent:done (no chat:complete)', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => makeStream([{ type: 'text_delta', delta: 'partial' }, { type: 'done' }])),
    };
    const service = await buildService(llmSource, sessionManager, toolDispatch);

    // Schedule an abort after the turn starts but before it finishes.
    const turnPromise = service.handleTurn('sid', 'q', 'p1', emit as EmitFn);
    // Microtask later: abort
    queueMicrotask(() => service.abort('sid'));
    await turnPromise;

    const events = captureEvents(emit);
    const interruptIdx = events.findIndex((e, i) =>
      e === 'chat:error' && (emit.mock.calls[i][1] as { code: string }).code === 'INTERRUPTED',
    );
    const doneIdx = events.lastIndexOf('agent:done');

    expect(interruptIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(interruptIdx);
    expect(events).not.toContain('chat:complete');
  });

  it('multi-iteration tool chain emits tool events strictly between context and complete', async () => {
    let iter = 0;
    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => {
        iter++;
        if (iter === 1) {
          return makeStream([
            { type: 'tool_call', callId: 'c1', name: 'list_raapps', args: {} },
            { type: 'done' },
          ]);
        }
        if (iter === 2) {
          return makeStream([
            { type: 'tool_call', callId: 'c2', name: 'run_raapp', args: { id: 'qa' } },
            { type: 'done' },
          ]);
        }
        return makeStream([
          { type: 'text_delta', delta: 'All done.' },
          { type: 'done' },
        ]);
      }),
    };
    const service = await buildService(llmSource, sessionManager, toolDispatch);

    await service.handleTurn('sid', 'do stuff', 'p1', emit as EmitFn);

    const events = captureEvents(emit);
    const ctxIdx = events.indexOf('chat:context');
    const completeIdx = events.indexOf('chat:complete');

    const toolStartIdxs = events.map((e, i) => (e === 'tool:start' ? i : -1)).filter((i) => i >= 0);
    const toolResultIdxs = events.map((e, i) => (e === 'tool:result' ? i : -1)).filter((i) => i >= 0);

    expect(toolStartIdxs).toHaveLength(2);
    expect(toolResultIdxs).toHaveLength(2);

    // All tool events between context and complete
    [...toolStartIdxs, ...toolResultIdxs].forEach((i) => {
      expect(i).toBeGreaterThan(ctxIdx);
      expect(i).toBeLessThan(completeIdx);
    });
    // Each tool:start precedes its tool:result
    expect(toolStartIdxs[0]).toBeLessThan(toolResultIdxs[0]);
    expect(toolStartIdxs[1]).toBeLessThan(toolResultIdxs[1]);
    // The two tool calls do not overlap (result of #1 before start of #2)
    expect(toolResultIdxs[0]).toBeLessThan(toolStartIdxs[1]);
  });
});
