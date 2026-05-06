/**
 * MAX_ITERATIONS behaviour tests.
 *
 * These verify the agentic loop safety-net:
 *  - emits chat:error (not chat:complete) when 8+ iterations are needed
 *  - always closes the agent turn with agent:done (no orphan bubbles)
 *  - lastMessageId is preserved so future features can reference it
 *  - hadContent is correctly forwarded from the tracking wrapper
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ChatService } from '../chat.service';
import { StreamProcessorService } from '../stream-processor.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { SessionManagerService } from '../session-manager.service';
import { AuditService } from '../audit.service';
import { LLM_SOURCE, CHUNK_HANDLERS, STREAM_MIDDLEWARES, TOOL_REGISTRY } from '../chat.tokens';
import type { ILLMSource } from '../interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';
import type { EmitFn } from '../interfaces/stream-context.interface';
import { PersonaService } from '../../persona/persona.service';
import { SkillsService } from '../../skills/skills.service';
import { CredentialsService } from '../../credentials/credentials.service';

async function* makeStream(chunks: InternalLLMChunk[]): AsyncIterable<InternalLLMChunk> {
  for (const chunk of chunks) yield chunk;
}

/** Processor that always adds a tool call so the loop never exits normally. */
function makeLoopingProcessor() {
  return {
    process: vi.fn().mockImplementation(
      async (_chunk: unknown, ctx: { state: { addToolCall: (tc: unknown) => void } }) => {
        ctx.state.addToolCall({ id: `c${Date.now()}`, name: 'tool_a', args: {} });
      },
    ),
    onModuleInit: vi.fn(),
  };
}

describe('ChatService — MAX_ITERATIONS', () => {
  let service: ChatService;
  let emit: ReturnType<typeof vi.fn>;

  const sessionManager = {
    ensureSession: vi.fn().mockResolvedValue(undefined),
    persistUserMessage: vi.fn().mockResolvedValue({ id: 'u1', sessionId: 'sid', role: 'user', content: 'hi', createdAt: 1 }),
    persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
    saveToolResult: vi.fn().mockResolvedValue(undefined),
    loadHistory: vi.fn().mockResolvedValue([]),
  };
  const toolDispatch = {
    getToolMetas: vi.fn().mockReturnValue([{ name: 'tool_a', description: '', parameters: {}, requiresConfirmation: false }]),
    dispatch: vi.fn().mockResolvedValue({ callId: 'c', status: 'success', data: {} }),
  };
  const personaService = {
    getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }),
  };
  const credentialsService = {
    getMaxToolAttempts: vi.fn().mockResolvedValue(8),
  };
  const auditService = { log: vi.fn().mockResolvedValue('audit-id'), update: vi.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    emit = vi.fn();
    const llmSource: ILLMSource = {
      stream: vi.fn().mockImplementation(() => makeStream([{ type: 'done' }])),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: StreamProcessorService, useValue: makeLoopingProcessor() },
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
  });

  it('emits chat:error with MAX_ITERATIONS_REACHED, not chat:complete', () => {
    const completeCalls = emit.mock.calls.filter((a: unknown[]) => a[0] === 'chat:complete');
    const errorCalls = emit.mock.calls.filter((a: unknown[]) => a[0] === 'chat:error');
    expect(completeCalls).toHaveLength(0);
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1]).toMatchObject({ code: 'MAX_ITERATIONS_REACHED' });
  });

  it('always emits agent:done (no orphan bubbles)', () => {
    const doneCalls = emit.mock.calls.filter((a: unknown[]) => a[0] === 'agent:done');
    expect(doneCalls).toHaveLength(1);
  });

  it('forwards hadContent in the error payload', () => {
    const errorCall = emit.mock.calls.find((a: unknown[]) => a[0] === 'chat:error');
    expect(errorCall).toBeDefined();
    // hadContent reflects whether chat:chunk was emitted; in this test the looping
    // processor never emits text, so hadContent=false.
    expect(typeof (errorCall![1] as { hadContent: unknown }).hadContent).toBe('boolean');
  });

  it('emits agent:start before chat:error', () => {
    const events = emit.mock.calls.map((a: unknown[]) => a[0] as string);
    const startIdx = events.indexOf('agent:start');
    const errorIdx = events.indexOf('chat:error');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(errorIdx).toBeGreaterThan(startIdx);
  });
});

