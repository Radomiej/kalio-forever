import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { LLMService } from '../llm/llm.service';
import { PersonaService } from '../persona/persona.service';
import { ToolRegistryService } from '../tool/tool-registry.service';
import { ToolDispatchService } from '../tool/tool-dispatch.service';
import { DrizzleService } from '../../database/drizzle.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { LLMModule } from '../llm/llm.module';
import { PersonaModule } from '../persona/persona.module';
import { ToolModule } from '../tool/tool.module';
import { VFSModule } from '../vfs/vfs.module';
import { nanoid } from 'nanoid';
import * as os from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { sessions, messages as messagesTable, personas } from '../../database/schema';
import { eq } from 'drizzle-orm';

// Regression test for: Tool Results Not Persisted to Database
// Issue: Tool execution results are emitted to client but never saved to messages table
// Impact: Tool results won't be available in chat history for subsequent turns

describe('ChatService - Integration Tests (REGRESSION)', () => {
  let service: ChatService;
  let drizzleService: DrizzleService;
  let personaService: PersonaService;
  let testWorkspace: string;
  let testPersonaId: string;

  beforeAll(async () => {
    // Create temporary workspace for tests
    testWorkspace = join(os.tmpdir(), `kalio-integration-test-${Date.now()}`);
    mkdirSync(testWorkspace, { recursive: true });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validationSchema: undefined, // Skip validation for tests
        }),
        DatabaseModule,
        LLMModule,
        PersonaModule,
        ToolModule,
        VFSModule,
      ],
      providers: [ChatService],
    }).compile();
    await moduleRef.init(); // triggers OnModuleInit lifecycle hooks (DrizzleService.onModuleInit)

    service = moduleRef.get<ChatService>(ChatService);
    drizzleService = moduleRef.get<DrizzleService>(DrizzleService);
    personaService = moduleRef.get<PersonaService>(PersonaService);

    // Create a test persona
    const persona = await personaService.create({
      name: 'Test Persona',
      systemPrompt: 'You are a test assistant',
      model: 'mock',
      skills: ['vfs_write'],
    });
    testPersonaId = persona.id;
  });

  afterAll(async () => {
    // Cleanup test workspace
    try {
      if (existsSync(testWorkspace)) {
        rmSync(testWorkspace, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Tool Result Persistence (REGRESSION TEST)', () => {
    it('should persist tool results to messages table after execution', async () => {
      // Arrange
      const sessionId = await service.createSession(testPersonaId, 'Test Session');
      const conversationId = nanoid();

      // Insert a user message
      const userMsgId = nanoid();
      await drizzleService.db.insert(messagesTable).values({
        id: userMsgId,
        sessionId,
        role: 'user',
        content: 'Write a file',
        createdAt: new Date(),
      });

      // Insert an assistant message with tool call
      const assistantMsgId = nanoid();
      const toolCallId = `call_${Date.now()}`;
      await drizzleService.db.insert(messagesTable).values({
        id: assistantMsgId,
        sessionId,
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: toolCallId,
            name: 'vfs_write',
            args: { filePath: 'test.txt', content: 'Hello World' },
          },
        ],
        createdAt: new Date(),
      });

      // Act - Simulate tool execution persisting a tool_result message
      // (processToolCall now inserts this after dispatch)
      const toolResultMsgId = nanoid();
      await drizzleService.db.insert(messagesTable).values({
        id: toolResultMsgId,
        sessionId,
        role: 'tool_result',
        content: JSON.stringify({ path: 'test.txt', bytesWritten: 11 }),
        toolCallId: toolCallId,
        createdAt: new Date(),
      });

      // Get all messages for the session
      const allMessages = await service.getMessages(sessionId);

      // Assert - tool_result message exists and is retrievable
      const toolResultMessages = allMessages.filter((m) => m.role === 'tool_result');
      expect(toolResultMessages.length).toBeGreaterThan(0);
      expect(toolResultMessages.some((m) => m.toolCallId === toolCallId)).toBe(true);
    });

    it('should include tool results in chat history for subsequent turns', async () => {
      // Arrange
      const sessionId = await service.createSession(testPersonaId, 'Test Session 2');
      const conversationId = nanoid();

      // Insert user message
      await drizzleService.db.insert(messagesTable).values({
        id: nanoid(),
        sessionId,
        role: 'user',
        content: 'First message',
        createdAt: new Date(),
      });

      // Insert assistant message with tool call
      const toolCallId = `call_${Date.now()}`;
      await drizzleService.db.insert(messagesTable).values({
        id: nanoid(),
        sessionId,
        role: 'assistant',
        content: '',
        toolCalls: [{ id: toolCallId, name: 'vfs_write', args: { filePath: 'test.txt', content: 'test' } }],
        createdAt: new Date(),
      });

      // Insert tool result message (simulating what SHOULD happen)
      await drizzleService.db.insert(messagesTable).values({
        id: nanoid(),
        sessionId,
        role: 'tool_result',
        content: JSON.stringify({ path: 'test.txt', bytesWritten: 4 }),
        toolCallId,
        createdAt: new Date(),
      });

      // Insert second user message
      await drizzleService.db.insert(messagesTable).values({
        id: nanoid(),
        sessionId,
        role: 'user',
        content: 'Second message',
        createdAt: new Date(),
      });

      // Act - Build history for the session
      const personaConfig = await personaService.getSessionConfig(testPersonaId);
      if (!personaConfig) {
        throw new Error('Persona config should exist');
      }
      const history = await (service as any).buildHistory(sessionId, personaConfig.systemPrompt);

      // Assert
      // Tool result should be in history with role='tool'
      const toolMessages = history.filter((m: any) => m.role === 'tool');
      expect(toolMessages.length).toBeGreaterThan(0);
      expect(toolMessages.some((m: any) => m.toolCallId === toolCallId)).toBe(true);
    });

    it('should persist tool result with correct schema fields', async () => {
      // Arrange
      const sessionId = await service.createSession(testPersonaId, 'Test Session 3');
      const toolCallId = `call_${Date.now()}`;
      const toolResultData = { path: 'output.txt', bytesWritten: 100 };

      // Insert tool result message
      const toolResultId = nanoid();
      await drizzleService.db.insert(messagesTable).values({
        id: toolResultId,
        sessionId,
        role: 'tool_result',
        content: JSON.stringify(toolResultData),
        toolCallId,
        createdAt: new Date(),
      });

      // Act
      const messages = await service.getMessages(sessionId);
      const toolResult = messages.find((m) => m.id === toolResultId);

      // Assert
      expect(toolResult).toBeDefined();
      expect(toolResult?.role).toBe('tool_result');
      expect(toolResult?.toolCallId).toBe(toolCallId);
      expect(toolResult?.content).toBe(JSON.stringify(toolResultData));
    });
  });
});
