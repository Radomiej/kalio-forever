import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatService } from '../chat.service';
import type { ILLMSource } from '../interfaces/llm-source.interface';
import type { EmitFn, StreamContext } from '../interfaces/stream-context.interface';
import { StreamProcessorService } from '../stream-processor.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { SessionManagerService } from '../session-manager.service';
import { AuditService } from '../audit.service';
import { PersonaService } from '../../persona/persona.service';
import { SkillsService } from '../../skills/skills.service';
import { CredentialsService } from '../../credentials/credentials.service';
import { LLM_SOURCE } from '../chat.tokens';
import type { LLMStreamChunk } from '@kalio/types';

describe('ChatService - Agent Loop Limits', () => {
  let service: ChatService;
  let mockLLMSource: ILLMSource;
  let mockStreamProcessor: StreamProcessorService;
  let mockSessionManager: SessionManagerService;
  let mockToolDispatch: ToolDispatchService;
  let mockPersonaService: PersonaService;
  let mockSkillsService: SkillsService;
  let mockCredentialsService: CredentialsService;
  let mockAudit: AuditService;
  let emittedEvents: Array<{ event: string; data: unknown }> = [];

  beforeEach(() => {
    emittedEvents = [];
    
    const emitFn: EmitFn = (event, data) => {
      emittedEvents.push({ event, data });
    };

    mockLLMSource = {
      stream: vi.fn(),
    };

    mockStreamProcessor = {
      process: vi.fn(),
    } as any;

    mockSessionManager = {
      ensureSession: vi.fn().mockResolvedValue(undefined),
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } as any;

    mockToolDispatch = {
      getToolMetas: vi.fn().mockReturnValue([]),
      dispatch: vi.fn().mockResolvedValue({ status: 'success', data: 'result' }),
    } as any;

    mockPersonaService = {
      getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', allowedTools: [] }),
    } as any;

    mockSkillsService = {
      findByIds: vi.fn().mockResolvedValue([]),
    } as any;

    mockAudit = {
      log: vi.fn().mockResolvedValue('audit-id'),
      update: vi.fn().mockResolvedValue(undefined),
    } as any;

    mockCredentialsService = {
      getMaxToolAttempts: vi.fn().mockResolvedValue(8),
    } as any;

    service = new ChatService(
      mockLLMSource as any,
      mockStreamProcessor,
      mockSessionManager,
      mockToolDispatch,
      mockPersonaService,
      mockSkillsService,
      mockCredentialsService,
      mockAudit,
    );
  });

  describe('agent loop - MAX_ITERATIONS guard', () => {
    it('should stop after MAX_ITERATIONS when tool always returns tool calls', async () => {
      // Arrange: Mock LLM to always return tool calls
      let iterationCount = 0;
      mockLLMSource.stream = vi.fn().mockImplementation(async function* () {
        iterationCount++;
        // Simulate tool call in every iteration
        yield { delta: '', done: false, sessionId: 'test', messageId: `msg-${iterationCount}` };
        yield { delta: 'thinking', done: false, sessionId: 'test', messageId: `msg-${iterationCount}`, thinking: true };
        yield { delta: '', done: true, sessionId: 'test', messageId: `msg-${iterationCount}` };
      });

      mockStreamProcessor.process = vi.fn().mockImplementation(async (chunk: LLMStreamChunk, ctx: StreamContext) => {
        if (chunk.thinking) {
          ctx.state.thinking = 'thinking content';
        }
        if (chunk.done) {
          // Always add a tool call to trigger another iteration
          ctx.state.toolCalls.push({
            id: `call-${iterationCount}`,
            name: 'test_tool',
            args: {},
          });
        }
      });

      mockToolDispatch.dispatch = vi.fn().mockResolvedValue({ status: 'success', data: 'result' });

      // Act
      await service.handleTurn('test-session', 'test message', 'default', (event, data) => {
        emittedEvents.push({ event, data });
      });

      // Assert - BUG CONFIRMED: Should stop at MAX_ITERATIONS (8) but let's verify
      const errorEvents = emittedEvents.filter(e => e.event === 'chat:error');
      const maxIterationError = errorEvents.find(e => 
        typeof e.data === 'object' && e.data !== null && 'code' in e.data && e.data.code === 'MAX_ITERATIONS_REACHED'
      );
      
      // The loop should stop at MAX_ITERATIONS
      expect(iterationCount).toBeLessThanOrEqual(9); // MAX_ITERATIONS (8) + 1 for safety
      expect(maxIterationError).toBeDefined();
    });

    it('should emit MAX_ITERATIONS_REACHED error when limit exceeded', async () => {
      // Arrange: Mock LLM to always return tool calls
      let iterationCount = 0;
      mockLLMSource.stream = vi.fn().mockImplementation(async function* () {
        iterationCount++;
        yield { delta: '', done: false, sessionId: 'test', messageId: `msg-${iterationCount}` };
        yield { delta: '', done: true, sessionId: 'test', messageId: `msg-${iterationCount}` };
      });

      mockStreamProcessor.process = vi.fn().mockImplementation(async (chunk: LLMStreamChunk, ctx: StreamContext) => {
        if (chunk.done) {
          ctx.state.toolCalls.push({
            id: `call-${iterationCount}`,
            name: 'test_tool',
            args: {},
          });
        }
      });

      mockToolDispatch.dispatch = vi.fn().mockResolvedValue({ status: 'success', data: 'result' });

      // Act
      await service.handleTurn('test-session', 'test message', 'default', (event, data) => {
        emittedEvents.push({ event, data });
      });

      // Assert
      const errorEvents = emittedEvents.filter(e => e.event === 'chat:error');
      const maxIterationError = errorEvents.find(e => 
        typeof e.data === 'object' && e.data !== null && 'code' in e.data && e.data.code === 'MAX_ITERATIONS_REACHED'
      );
      
      expect(maxIterationError).toBeDefined();
      if (maxIterationError) {
        expect(maxIterationError.data).toMatchObject({
          code: 'MAX_ITERATIONS_REACHED',
          message: expect.stringContaining('exceeded 8 iterations'),
        });
      }
    });

    it('should complete normally when tool stops returning calls', async () => {
      // Arrange: Mock LLM to return tool calls only in first iteration
      let iterationCount = 0;
      mockLLMSource.stream = vi.fn().mockImplementation(async function* () {
        iterationCount++;
        yield { delta: '', done: false, sessionId: 'test', messageId: `msg-${iterationCount}` };
        yield { delta: '', done: true, sessionId: 'test', messageId: `msg-${iterationCount}` };
      });

      mockStreamProcessor.process = vi.fn().mockImplementation(async (chunk: LLMStreamChunk, ctx: StreamContext) => {
        if (chunk.done && iterationCount === 1) {
          // Only first iteration returns tool call
          ctx.state.toolCalls.push({
            id: 'call-1',
            name: 'test_tool',
            args: {},
          });
          return;
        }
        // Second and subsequent iterations return no tool calls
        if (chunk.done) {
          ctx.state.text = 'done';
        }
      });

      mockToolDispatch.dispatch = vi.fn().mockResolvedValue({ status: 'success', data: 'result' });

      // Act
      await service.handleTurn('test-session', 'test message', 'default', (event, data) => {
        emittedEvents.push({ event, data });
      });

      // Assert - Should complete normally without MAX_ITERATIONS error
      const errorEvents = emittedEvents.filter(e => e.event === 'chat:error');
      const maxIterationError = errorEvents.find(e => 
        typeof e.data === 'object' && e.data !== null && 'code' in e.data && e.data.code === 'MAX_ITERATIONS_REACHED'
      );
      
      expect(maxIterationError).toBeUndefined();
      expect(iterationCount).toBe(2); // First with tool call, second without
    });

    it('should continue when first no-tool iteration is empty after tool execution', async () => {
      let iterationCount = 0;
      mockLLMSource.stream = vi.fn().mockImplementation(async function* () {
        iterationCount++;
        yield { delta: '', done: false, sessionId: 'test', messageId: `msg-${iterationCount}` };
        yield { delta: '', done: true, sessionId: 'test', messageId: `msg-${iterationCount}` };
      });

      mockStreamProcessor.process = vi.fn().mockImplementation(async (chunk: LLMStreamChunk, ctx: StreamContext) => {
        if (!chunk.done) return;
        if (iterationCount === 1) {
          ctx.state.toolCalls.push({ id: 'call-1', name: 'test_tool', args: {} });
          return;
        }
        if (iterationCount === 2) {
          // Empty no-tool pass: this can happen with some providers and should not end the turn.
          return;
        }
        ctx.state.text = 'Final answer';
      });

      mockToolDispatch.dispatch = vi.fn().mockResolvedValue({ status: 'success', data: 'result' });

      await service.handleTurn('test-session', 'test message', 'default', (event, data) => {
        emittedEvents.push({ event, data });
      });

      const completeEvents = emittedEvents.filter(e => e.event === 'chat:complete');
      expect(completeEvents).toHaveLength(1);
      expect(iterationCount).toBe(3);
    });

    it('should not consume max iterations for repeated empty no-tool retries', async () => {
      mockCredentialsService.getMaxToolAttempts = vi.fn().mockResolvedValue(2);

      let iterationCount = 0;
      mockLLMSource.stream = vi.fn().mockImplementation(async function* () {
        iterationCount++;
        yield { delta: '', done: false, sessionId: 'test', messageId: `msg-${iterationCount}` };
        yield { delta: '', done: true, sessionId: 'test', messageId: `msg-${iterationCount}` };
      });

      mockStreamProcessor.process = vi.fn().mockImplementation(async (chunk: LLMStreamChunk, ctx: StreamContext) => {
        if (!chunk.done) return;
        if (iterationCount === 1) {
          ctx.state.toolCalls.push({ id: 'call-1', name: 'test_tool', args: {} });
          return;
        }

        // Simulate flaky provider responses after tool execution.
        if (iterationCount >= 2 && iterationCount <= 4) {
          return;
        }

        ctx.state.text = 'Recovered final answer';
      });

      await service.handleTurn('test-session', 'test message', 'default', (event, data) => {
        emittedEvents.push({ event, data });
      });

      const maxIterationError = emittedEvents.find(e =>
        e.event === 'chat:error' &&
        typeof e.data === 'object' &&
        e.data !== null &&
        'code' in e.data &&
        e.data.code === 'MAX_ITERATIONS_REACHED'
      );
      const completeEvents = emittedEvents.filter(e => e.event === 'chat:complete');

      expect(maxIterationError).toBeUndefined();
      expect(completeEvents).toHaveLength(1);
      expect(iterationCount).toBe(5);
    });
  });
});
