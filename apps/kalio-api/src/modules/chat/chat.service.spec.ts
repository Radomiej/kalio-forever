import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { LLMService } from '../llm/llm.service';
import { PersonaService } from '../persona/persona.service';
import { ToolRegistryService } from '../tool/tool-registry.service';
import { ToolDispatchService } from '../tool/tool-dispatch.service';
import { DrizzleService } from '../../database/drizzle.service';
import { CredentialsService } from '../credentials/credentials.service';
import { Logger } from '@nestjs/common';

// Regression test for: Silent failure in resolveConfirmation
// Issue: Missing requestId is silently ignored with no logging
// AGENTS.md rule: "Every error logged + handled"

describe('ChatService', () => {
  let service: ChatService;
  let logger: Logger;
  let moduleRef: TestingModule;

  // Flexible Drizzle mock that handles both .limit() and .orderBy() chains
  const makeSelectChain = (rows: unknown[] = []) => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
        orderBy: vi.fn().mockResolvedValue(rows),
      }),
      orderBy: vi.fn().mockResolvedValue(rows),
    }),
  });

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: LLMService,
          useValue: {
            streamChat: vi.fn(),
            getConfig: vi.fn(),
          },
        },
        {
          provide: PersonaService,
          useValue: {
            getSessionConfig: vi.fn(),
          },
        },
        {
          provide: ToolRegistryService,
          useValue: {
            getMeta: vi.fn(),
            getToolsForSkills: vi.fn(),
          },
        },
        {
          provide: ToolDispatchService,
          useValue: {
            dispatch: vi.fn(),
          },
        },
        {
          provide: DrizzleService,
          useValue: {
            db: {
              insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
              select: vi.fn().mockImplementation(() => makeSelectChain([{ id: 's1' }])),
              update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
              delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            },
          },
        },
        {
          provide: CredentialsService,
          useValue: {
            getContextWindowSize: vi.fn().mockResolvedValue(32000),
            getActiveProviderConfig: vi.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<ChatService>(ChatService);
    logger = service['logger'];
  });

  describe('resolveConfirmation - Silent Failure (REGRESSION TEST)', () => {
    it('should log warning when requestId does not exist', async () => {
      // Arrange
      const nonExistentRequestId = 'non-existent-request-id';
      const spyWarn = vi.spyOn(logger, 'warn');

      // Act
      await service.resolveConfirmation(nonExistentRequestId, 'confirmed');

      // Assert
      // BUG: Current implementation silently does nothing when requestId not found
      // Expected: Should log a warning about the missing requestId
      // This test will fail until the bug is fixed
      expect(spyWarn).toHaveBeenCalledWith(
        expect.stringContaining('requestId'),
        expect.stringContaining(nonExistentRequestId),
      );
    });

    it('should handle duplicate confirmation attempts gracefully', async () => {
      // Arrange
      const requestId = 'test-request-id';
      const spyWarn = vi.spyOn(logger, 'warn');

      // First confirmation
      await service.resolveConfirmation(requestId, 'confirmed');

      // Second confirmation (duplicate)
      await service.resolveConfirmation(requestId, 'confirmed');

      // Assert
      // Should log warning about duplicate confirmation attempt
      expect(spyWarn).toHaveBeenCalled();
    });
  });

  describe('waitForConfirmation - Memory Leak (REGRESSION TEST)', () => {
    it('should clear timeout when confirmation arrives', async () => {
      // Arrange
      const requestId = 'test-request-id';
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Set up a pending confirmation (registers the timer)
      const waitPromise = (service as any)['waitForConfirmation'](requestId, 5000);

      // Act - resolve confirmation before timeout
      await service.resolveConfirmation(requestId, 'confirmed');
      await waitPromise;

      // Assert
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should not accumulate timers on multiple confirmations', async () => {
      // Arrange
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const requestIds = Array.from({ length: 10 }, (_, i) => `req-${i}`);

      // Act - create multiple pending confirmations
      for (const requestId of requestIds) {
        await service.resolveConfirmation(requestId, 'confirmed');
      }

      // Assert
      // Number of clearTimers should equal number of setTimeouts (no leak)
      // BUG: Current implementation has memory leak - timers never cleared
      // This test will fail until the bug is fixed
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(setTimeoutSpy.mock.calls.length);
    });
  });

  describe('createSession', () => {
    it('should create a session with valid persona', async () => {
      // Arrange
      const personaId = 'persona-123';
      const title = 'Test Session';

      // Act
      const sessionId = await service.createSession(personaId, title);

      // Assert
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
    });
  });

  describe('getSession', () => {
    it('should return null for non-existent session', async () => {
      // Arrange
      const nonExistentId = 'non-existent-session';

      // Act
      const session = await service.getSession(nonExistentId);

      // Assert
      expect(session).toBeNull();
    });
  });

  describe('processToolCall - Tool Result Persistence Error Handling (REGRESSION TEST)', () => {
    it('should handle database errors when persisting tool results', async () => {
      // Arrange
      const mockDb = (service as any).drizzle.db;
      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('Database connection failed')),
      });
      mockDb.insert = mockInsert;

      const mockToolMeta = {
        name: 'test_tool',
        description: 'Test tool',
        parameters: {},
        requiresConfirmation: false,
      };
      const toolRegistry = moduleRef.get<ToolRegistryService>(ToolRegistryService);
      vi.spyOn(toolRegistry, 'getMeta').mockReturnValue(mockToolMeta);

      const mockToolResult = {
        callId: 'call-123',
        status: 'success' as const,
        data: { result: 'test' },
      };
      const toolDispatch = moduleRef.get<ToolDispatchService>(ToolDispatchService);
      vi.spyOn(toolDispatch, 'dispatch').mockResolvedValue(mockToolResult);

      const tc = {
        id: 'call-123',
        name: 'test_tool',
        args: { test: 'value' },
      };

      const mockClient = {
        emit: vi.fn(),
      } as any;

      const mockServer = {
        emit: vi.fn(),
      } as any;

      const spyError = vi.spyOn(service['logger'], 'error');

      // Act
      await (service as any)['processToolCall'](
        tc,
        'session-123',
        mockServer,
        mockClient,
        ['test_tool'],
      );

      // Assert
      // BUG: Current implementation does not handle database errors when persisting tool results
      // Expected: Should log the error and still emit tool:result to client
      // This test will fail until the bug is fixed
      expect(spyError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist tool result'),
        expect.any(Error),
      );
      expect(mockClient.emit).toHaveBeenCalledWith('tool:result', mockToolResult);
    });
  });

  describe('handleMessage - Sensitive Data Logging (REGRESSION TEST)', () => {
    it('should not log full tool arguments that may contain sensitive data', async () => {
      // Arrange
      const personaConfig = {
        systemPrompt: 'Test system prompt',
        model: 'gpt-4',
        availableSkills: ['test_tool'],
        kv: {},
      };
      const personaService = moduleRef.get<PersonaService>(PersonaService);
      vi.spyOn(personaService, 'getSessionConfig').mockResolvedValue(personaConfig);

      const mockToolCall = {
        id: 'call-123',
        name: 'test_tool',
        args: { apiKey: 'secret-key-12345', password: 'my-password' },
      };
      const llmService = moduleRef.get<LLMService>(LLMService);
      vi.spyOn(llmService, 'streamChat').mockResolvedValue([mockToolCall]);

      const mockToolMeta = {
        name: 'test_tool',
        description: 'Test tool',
        parameters: {},
        requiresConfirmation: false,
      };
      const toolRegistry = moduleRef.get<ToolRegistryService>(ToolRegistryService);
      vi.spyOn(toolRegistry, 'getMeta').mockReturnValue(mockToolMeta);
      vi.spyOn(toolRegistry, 'getToolsForSkills').mockReturnValue([mockToolMeta]);

      const mockToolResult = {
        callId: 'call-123',
        status: 'success' as const,
        data: { result: 'test' },
      };
      const toolDispatch = moduleRef.get<ToolDispatchService>(ToolDispatchService);
      vi.spyOn(toolDispatch, 'dispatch').mockResolvedValue(mockToolResult);

      const mockClient = {
        emit: vi.fn(),
      } as any;

      const mockServer = {
        emit: vi.fn(),
      } as any;

      const spyLog = vi.spyOn(service['logger'], 'log');

      const payload = {
        sessionId: 'session-123',
        content: 'Test message',
        personaId: 'persona-123',
      };

      // Act
      await service.handleMessage(payload, mockServer, mockClient);

      // Assert
      // BUG: Current implementation logs full tool arguments with JSON.stringify
      // Expected: Should truncate or redact sensitive data in logs
      // This test will fail until the bug is fixed
      const logCalls = spyLog.mock.calls.map((call) => call[0]);
      const argsLog = logCalls.find((call) => call.includes('args='));
      expect(argsLog).toBeDefined();
      // Should not contain full sensitive values
      expect(argsLog).not.toContain('secret-key-12345');
      expect(argsLog).not.toContain('my-password');
    });
  });

  // ─── Streaming + HITL Gate Tests ─────────────────────────────────────────────

  describe('handleMessage - Streaming + HITL Gate', () => {
    function makeClient() {
      return { emit: vi.fn() } as any;
    }
    function makeServer() {
      return { emit: vi.fn() } as any;
    }

    function makePersonaConfig(skills: string[] = []) {
      return { systemPrompt: 'You are test.', model: '', availableSkills: skills, kv: {} };
    }

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should emit chat:chunk for each streaming delta and chat:complete when done', async () => {
      // Arrange
      const client = makeClient();
      const server = makeServer();
      const personaService = moduleRef.get<PersonaService>(PersonaService);
      vi.spyOn(personaService, 'getSessionConfig').mockResolvedValue(makePersonaConfig());

      const toolRegistry = moduleRef.get<ToolRegistryService>(ToolRegistryService);
      vi.spyOn(toolRegistry, 'getToolsForSkills').mockReturnValue([]);

      const llmService = moduleRef.get<LLMService>(LLMService);
      vi.spyOn(llmService, 'streamChat').mockImplementation(async (_msgs, _tools, onChunk, sessionId, messageId) => {
        onChunk({ delta: 'Hello ', done: false, sessionId, messageId });
        onChunk({ delta: 'world!', done: false, sessionId, messageId });
        onChunk({ delta: '', done: true, sessionId, messageId });
        return [];
      });

      // Act
      await service.handleMessage(
        { sessionId: 's1', content: 'hi', personaId: 'p1',  },
        server, client,
      );

      // Assert
      const chunks = (client.emit as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === 'chat:chunk');
      expect(chunks.length).toBe(3);
      expect(chunks[0][1].delta).toBe('Hello ');
      expect(chunks[1][1].delta).toBe('world!');
      expect(chunks[2][1].done).toBe(true);

      const completes = (client.emit as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === 'chat:complete');
      expect(completes.length).toBeGreaterThanOrEqual(1);
    });

    it('should emit chat:error and return early when persona not found', async () => {
      // Arrange
      const client = makeClient();
      const server = makeServer();
      const personaService = moduleRef.get<PersonaService>(PersonaService);
      vi.spyOn(personaService, 'getSessionConfig').mockResolvedValue(null);

      // Act
      await service.handleMessage(
        { sessionId: 's1', content: 'hi', personaId: 'missing-persona' },
        server, client,
      );

      // Assert — error emitted on server, no chunk emitted
      const serverEmitCalls = (server.emit as ReturnType<typeof vi.fn>).mock.calls;
      expect(serverEmitCalls.some((c) => c[0] === 'chat:error')).toBe(true);
      expect((client.emit as ReturnType<typeof vi.fn>).mock.calls.every((c) => c[0] !== 'chat:chunk')).toBe(true);
    });

    it('should emit chat:error when LLM throws', async () => {
      // Arrange
      const client = makeClient();
      const server = makeServer();
      const personaService = moduleRef.get<PersonaService>(PersonaService);
      vi.spyOn(personaService, 'getSessionConfig').mockResolvedValue(makePersonaConfig());

      const toolRegistry = moduleRef.get<ToolRegistryService>(ToolRegistryService);
      vi.spyOn(toolRegistry, 'getToolsForSkills').mockReturnValue([]);

      const llmService = moduleRef.get<LLMService>(LLMService);
      vi.spyOn(llmService, 'streamChat').mockRejectedValue(new Error('LLM timeout'));

      // Act
      await service.handleMessage(
        { sessionId: 's1', content: 'hi', personaId: 'p1',  },
        server, client,
      );

      // Assert
      const serverEmitCalls = (server.emit as ReturnType<typeof vi.fn>).mock.calls;
      const errorCall = serverEmitCalls.find((c) => c[0] === 'chat:error');
      expect(errorCall).toBeDefined();
      expect(errorCall![1].code).toBe('LLM_ERROR');
      expect(errorCall![1].message).toBe('LLM timeout');
    });

    it('should emit tool:confirmation_required with toolCallId when tool requiresConfirmation', async () => {
      // Arrange
      const client = makeClient();
      const server = makeServer();
      const personaService = moduleRef.get<PersonaService>(PersonaService);
      vi.spyOn(personaService, 'getSessionConfig').mockResolvedValue(makePersonaConfig(['vfs_write']));

      const toolRegistry = moduleRef.get<ToolRegistryService>(ToolRegistryService);
      const toolMeta = { name: 'vfs_write', description: 'Write file', parameters: {}, requiresConfirmation: true };
      vi.spyOn(toolRegistry, 'getMeta').mockReturnValue(toolMeta);
      vi.spyOn(toolRegistry, 'getToolsForSkills').mockReturnValue([toolMeta]);

      const toolCallId = 'call_test_001';
      const llmService = moduleRef.get<LLMService>(LLMService);
      vi.spyOn(llmService, 'streamChat').mockResolvedValue([
        { id: toolCallId, name: 'vfs_write', args: { filePath: 'test.txt', content: 'data' } },
      ]);

      // Auto-confirm after a tick
      setTimeout(async () => {
        await service.resolveConfirmation(
          (client.emit as ReturnType<typeof vi.fn>).mock.calls
            .find((c) => c[0] === 'tool:confirmation_required')?.[1]?.requestId ?? '',
          'confirmed',
        );
      }, 10);

      const toolDispatch = moduleRef.get<ToolDispatchService>(ToolDispatchService);
      vi.spyOn(toolDispatch, 'dispatch').mockResolvedValue({ callId: toolCallId, status: 'success', data: {} });

      const followUpLlm = vi.spyOn(llmService, 'streamChat');
      followUpLlm.mockResolvedValueOnce([{ id: toolCallId, name: 'vfs_write', args: {} }]); // first call with tool call
      followUpLlm.mockResolvedValueOnce([]); // follow-up call

      // Act
      await service.handleMessage(
        { sessionId: 's1', content: 'write file', personaId: 'p1',  },
        server, client,
      );

      // Assert — confirmation_required includes toolCallId
      const confirmEmit = (client.emit as ReturnType<typeof vi.fn>).mock.calls
        .find((c) => c[0] === 'tool:confirmation_required');
      expect(confirmEmit).toBeDefined();
      expect(confirmEmit![1].toolCallId).toBe(toolCallId);
      expect(confirmEmit![1].requestId).toBeDefined();
    });

    it('should emit tool:result with status=cancelled when user cancels HITL', async () => {
      // Arrange
      const client = makeClient();
      const server = makeServer();
      const personaService = moduleRef.get<PersonaService>(PersonaService);
      vi.spyOn(personaService, 'getSessionConfig').mockResolvedValue(makePersonaConfig(['vfs_write']));

      const toolRegistry = moduleRef.get<ToolRegistryService>(ToolRegistryService);
      const toolMeta = { name: 'vfs_write', description: 'Write file', parameters: {}, requiresConfirmation: true };
      vi.spyOn(toolRegistry, 'getMeta').mockReturnValue(toolMeta);
      vi.spyOn(toolRegistry, 'getToolsForSkills').mockReturnValue([toolMeta]);

      const toolCallId = 'call_cancel_001';
      const llmService = moduleRef.get<LLMService>(LLMService);
      vi.spyOn(llmService, 'streamChat').mockResolvedValueOnce([
        { id: toolCallId, name: 'vfs_write', args: { filePath: 'test.txt', content: 'data' } },
      ]).mockResolvedValueOnce([]); // follow-up never runs because cancelled

      // Auto-cancel after a tick
      setTimeout(async () => {
        const requestId = (client.emit as ReturnType<typeof vi.fn>).mock.calls
          .find((c) => c[0] === 'tool:confirmation_required')?.[1]?.requestId ?? '';
        await service.resolveConfirmation(requestId, 'cancelled');
      }, 10);

      // Act
      await service.handleMessage(
        { sessionId: 's1', content: 'write file', personaId: 'p1',  },
        server, client,
      );

      // Assert
      const toolResultEmit = (client.emit as ReturnType<typeof vi.fn>).mock.calls
        .find((c) => c[0] === 'tool:result');
      expect(toolResultEmit).toBeDefined();
      expect(toolResultEmit![1].status).toBe('cancelled');

      // Dispatch should NOT have been called
      const toolDispatch = moduleRef.get<ToolDispatchService>(ToolDispatchService);
      expect(vi.mocked(toolDispatch.dispatch)).not.toHaveBeenCalled();
    });

    it('should auto-cancel HITL after 30 second timeout', async () => {
      vi.useFakeTimers();
      try {
        // Arrange
        const client = makeClient();
        const server = makeServer();
        const personaService = moduleRef.get<PersonaService>(PersonaService);
        vi.spyOn(personaService, 'getSessionConfig').mockResolvedValue(makePersonaConfig(['vfs_write']));

        const toolRegistry = moduleRef.get<ToolRegistryService>(ToolRegistryService);
        const toolMeta = { name: 'vfs_write', description: 'Write file', parameters: {}, requiresConfirmation: true };
        vi.spyOn(toolRegistry, 'getMeta').mockReturnValue(toolMeta);
        vi.spyOn(toolRegistry, 'getToolsForSkills').mockReturnValue([toolMeta]);

        const llmService = moduleRef.get<LLMService>(LLMService);
        vi.spyOn(llmService, 'streamChat').mockResolvedValueOnce([
          { id: 'call_timeout_001', name: 'vfs_write', args: {} },
        ]).mockResolvedValueOnce([]);

        const toolDispatch = moduleRef.get<ToolDispatchService>(ToolDispatchService);
        vi.spyOn(toolDispatch, 'dispatch').mockResolvedValue({ callId: 'call_timeout_001', status: 'success', data: {} });

        // Act — start the message handler but advance timers to trigger timeout
        const handlePromise = service.handleMessage(
          { sessionId: 's1', content: 'write', personaId: 'p1',  },
          server, client,
        );

        // Advance past 30 second timeout
        await vi.advanceTimersByTimeAsync(31_000);
        await handlePromise;

        // Assert — tool:result should be cancelled due to timeout (not dispatched)
        const toolResultEmit = (client.emit as ReturnType<typeof vi.fn>).mock.calls
          .find((c) => c[0] === 'tool:result');
        expect(toolResultEmit).toBeDefined();
        expect(toolResultEmit![1].status).toBe('cancelled');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should emit tool:result with TOOL_NOT_FOUND when tool is not registered', async () => {
      // Arrange
      const client = makeClient();
      const server = makeServer();
      const personaService = moduleRef.get<PersonaService>(PersonaService);
      vi.spyOn(personaService, 'getSessionConfig').mockResolvedValue(makePersonaConfig(['unknown_tool']));

      const toolRegistry = moduleRef.get<ToolRegistryService>(ToolRegistryService);
      vi.spyOn(toolRegistry, 'getMeta').mockReturnValue(undefined);
      vi.spyOn(toolRegistry, 'getToolsForSkills').mockReturnValue([]);

      const llmService = moduleRef.get<LLMService>(LLMService);
      vi.spyOn(llmService, 'streamChat').mockResolvedValueOnce([
        { id: 'call_bad_001', name: 'unknown_tool', args: {} },
      ]).mockResolvedValueOnce([]);

      // Act
      await service.handleMessage(
        { sessionId: 's1', content: 'use unknown tool', personaId: 'p1',  },
        server, client,
      );

      // Assert
      const toolResultEmit = (client.emit as ReturnType<typeof vi.fn>).mock.calls
        .find((c) => c[0] === 'tool:result');
      expect(toolResultEmit).toBeDefined();
      expect(toolResultEmit![1].status).toBe('error');
      expect(toolResultEmit![1].errorCode).toBe('TOOL_NOT_FOUND');
    });

    it('should execute tool without confirmation when requiresConfirmation=false', async () => {
      // Arrange
      const client = makeClient();
      const server = makeServer();
      const personaService = moduleRef.get<PersonaService>(PersonaService);
      vi.spyOn(personaService, 'getSessionConfig').mockResolvedValue(makePersonaConfig(['read_tool']));

      const toolRegistry = moduleRef.get<ToolRegistryService>(ToolRegistryService);
      const toolMeta = { name: 'read_tool', description: 'Read file', parameters: {}, requiresConfirmation: false };
      vi.spyOn(toolRegistry, 'getMeta').mockReturnValue(toolMeta);
      vi.spyOn(toolRegistry, 'getToolsForSkills').mockReturnValue([toolMeta]);

      const llmService = moduleRef.get<LLMService>(LLMService);
      vi.spyOn(llmService, 'streamChat')
        .mockResolvedValueOnce([{ id: 'call_read_001', name: 'read_tool', args: { path: 'file.txt' } }])
        .mockResolvedValueOnce([]);

      const toolDispatch = moduleRef.get<ToolDispatchService>(ToolDispatchService);
      vi.spyOn(toolDispatch, 'dispatch').mockResolvedValue({
        callId: 'call_read_001', status: 'success', data: { content: 'hello' },
      });

      // Act
      await service.handleMessage(
        { sessionId: 's1', content: 'read file', personaId: 'p1',  },
        server, client,
      );

      // Assert — NO confirmation dialog emitted
      const confirmEmits = (client.emit as ReturnType<typeof vi.fn>).mock.calls
        .filter((c) => c[0] === 'tool:confirmation_required');
      expect(confirmEmits).toHaveLength(0);

      // Tool dispatch IS called directly
      expect(vi.mocked(toolDispatch.dispatch)).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'read_tool', callId: 'call_read_001' }),
      );

      // tool:result emitted
      const toolResultEmit = (client.emit as ReturnType<typeof vi.fn>).mock.calls
        .find((c) => c[0] === 'tool:result');
      expect(toolResultEmit).toBeDefined();
      expect(toolResultEmit![1].status).toBe('success');
    });

    it('should persist user message, assistant message, and tool result to DB in correct order', async () => {
      // Arrange
      const client = makeClient();
      const server = makeServer();
      const personaService = moduleRef.get<PersonaService>(PersonaService);
      vi.spyOn(personaService, 'getSessionConfig').mockResolvedValue(makePersonaConfig(['read_tool']));

      const toolRegistry = moduleRef.get<ToolRegistryService>(ToolRegistryService);
      const toolMeta = { name: 'read_tool', description: 'Read file', parameters: {}, requiresConfirmation: false };
      vi.spyOn(toolRegistry, 'getMeta').mockReturnValue(toolMeta);
      vi.spyOn(toolRegistry, 'getToolsForSkills').mockReturnValue([toolMeta]);

      const toolCallId = 'call_persist_001';
      const llmService = moduleRef.get<LLMService>(LLMService);
      vi.spyOn(llmService, 'streamChat')
        .mockResolvedValueOnce([{ id: toolCallId, name: 'read_tool', args: {} }])
        .mockResolvedValueOnce([]);

      const toolDispatch = moduleRef.get<ToolDispatchService>(ToolDispatchService);
      vi.spyOn(toolDispatch, 'dispatch').mockResolvedValue({ callId: toolCallId, status: 'success', data: 'ok' });

      const drizzle = moduleRef.get<DrizzleService>(DrizzleService);
      const insertSpy = vi.spyOn(drizzle.db, 'insert');

      // Act
      await service.handleMessage(
        { sessionId: 's1', content: 'read', personaId: 'p1',  },
        server, client,
      );

      // Assert — insert was called for user msg, assistant msg, tool result, follow-up assistant msg
      expect(insertSpy).toHaveBeenCalledTimes(4);
    });

    it('should redact api_key and password fields in tool arg logs', async () => {
      // Arrange
      const client = makeClient();
      const server = makeServer();
      const personaService = moduleRef.get<PersonaService>(PersonaService);
      vi.spyOn(personaService, 'getSessionConfig').mockResolvedValue(makePersonaConfig(['secure_tool']));

      const toolRegistry = moduleRef.get<ToolRegistryService>(ToolRegistryService);
      const toolMeta = { name: 'secure_tool', description: 'Secure tool', parameters: {}, requiresConfirmation: false };
      vi.spyOn(toolRegistry, 'getMeta').mockReturnValue(toolMeta);
      vi.spyOn(toolRegistry, 'getToolsForSkills').mockReturnValue([toolMeta]);

      const llmService = moduleRef.get<LLMService>(LLMService);
      vi.spyOn(llmService, 'streamChat')
        .mockResolvedValueOnce([{ id: 'call_sec_001', name: 'secure_tool', args: { api_key: 'sk-secret', data: 'ok' } }])
        .mockResolvedValueOnce([]);

      const toolDispatch = moduleRef.get<ToolDispatchService>(ToolDispatchService);
      vi.spyOn(toolDispatch, 'dispatch').mockResolvedValue({ callId: 'call_sec_001', status: 'success', data: {} });

      const logSpy = vi.spyOn(service['logger'], 'log');

      // Act
      await service.handleMessage(
        { sessionId: 's1', content: 'use secure tool', personaId: 'p1',  },
        server, client,
      );

      // Assert — api_key value must be redacted in logs
      const allLogMessages = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
      expect(allLogMessages).not.toContain('sk-secret');
    });
  });

  // ─── HITL resolveConfirmation - full round trip ────────────────────────────

  describe('resolveConfirmation - full HITL round trip', () => {
    it('should resolve confirmed decision and allow tool dispatch', async () => {
      const requestId = 'hitl-roundtrip-001';
      const waitPromise = (service as any)['waitForConfirmation'](requestId, 5000);
      await service.resolveConfirmation(requestId, 'confirmed');
      const decision = await waitPromise;
      expect(decision).toBe('confirmed');
    });

    it('should resolve cancelled decision', async () => {
      const requestId = 'hitl-roundtrip-002';
      const waitPromise = (service as any)['waitForConfirmation'](requestId, 5000);
      await service.resolveConfirmation(requestId, 'cancelled');
      const decision = await waitPromise;
      expect(decision).toBe('cancelled');
    });

    it('should clean up pendingConfirmations map after resolution to prevent memory leak', async () => {
      const requestId = 'hitl-cleanup-001';
      const waitPromise = (service as any)['waitForConfirmation'](requestId, 5000);
      const mapBefore = (service as any)['pendingConfirmations'].size;
      await service.resolveConfirmation(requestId, 'confirmed');
      await waitPromise;
      const mapAfter = (service as any)['pendingConfirmations'].size;
      expect(mapAfter).toBe(mapBefore - 1);
    });

    it('should time out and return cancelled after timeoutMs, cleaning up map', async () => {
      vi.useFakeTimers();
      try {
        const requestId = 'hitl-timeout-001';
        const waitPromise = (service as any)['waitForConfirmation'](requestId, 500);
        await vi.advanceTimersByTimeAsync(600);
        const decision = await waitPromise;
        expect(decision).toBe('cancelled');
        expect((service as any)['pendingConfirmations'].has(requestId)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
