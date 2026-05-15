import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { SessionManagerService } from '../session-manager.service';
import { ImageHydratorService } from '../image-hydrator.service';
import { TurnState } from '../turn-state';
import { MESSAGE_REPOSITORY } from '../chat.tokens';
import type { IMessageRepository } from '../interfaces/message-repository.interface';
import type { ChatMessage } from '@kalio/types';
import { CredentialsService } from '../../credentials/credentials.service';

function makeRepo(messages: ChatMessage[] = []): IMessageRepository {
  return {
    ensureSession: vi.fn().mockResolvedValue(undefined),
    loadHistory: vi.fn().mockResolvedValue(messages),
    saveMessage: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SessionManagerService', () => {
  let service: SessionManagerService;
  let repo: IMessageRepository;
  let credentialsService: { getContextWindowSize: ReturnType<typeof vi.fn> };

  async function buildSessionManager(
    messages: ChatMessage[] = [],
    hydrator: { hydrate: ReturnType<typeof vi.fn> } = { hydrate: vi.fn().mockResolvedValue([]) },
  ): Promise<{ service: SessionManagerService; repo: IMessageRepository; hydrator: { hydrate: ReturnType<typeof vi.fn> } }> {
    const nextRepo = makeRepo(messages);
    const moduleRef = await Test.createTestingModule({
      providers: [
        SessionManagerService,
        { provide: MESSAGE_REPOSITORY, useValue: nextRepo },
        { provide: ImageHydratorService, useValue: hydrator },
        { provide: CredentialsService, useValue: credentialsService },
      ],
    }).compile();

    return {
      service: moduleRef.get(SessionManagerService),
      repo: nextRepo,
      hydrator,
    };
  }

  beforeEach(async () => {
    credentialsService = {
      getContextWindowSize: vi.fn().mockResolvedValue(32000),
    };
    ({ service, repo } = await buildSessionManager());
  });

  describe('persistUserMessage', () => {
    it('saves a user message to the repo', async () => {
      await service.persistUserMessage('sid', 'hello');
      expect(repo.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sid', role: 'user', content: 'hello' }),
      );
    });

    it('returns a ChatMessage with generated id and createdAt', async () => {
      const msg = await service.persistUserMessage('sid', 'test');
      expect(msg.id).toBeTruthy();
      expect(msg.createdAt).toBeGreaterThan(0);
    });
  });

  describe('persistAssistantMessage', () => {
    it('saves assistant message with text from state', async () => {
      const state = new TurnState();
      state.appendText('The answer is 42.');
      await service.persistAssistantMessage('sid', 'mid-1', state);

      expect(repo.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mid-1', role: 'assistant', content: 'The answer is 42.' }),
      );
    });

    it('includes thinking when present', async () => {
      const state = new TurnState();
      state.appendThinking('step 1');
      state.appendText('answer');
      await service.persistAssistantMessage('sid', 'mid-2', state);

      expect(repo.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ thinking: 'step 1' }),
      );
    });

    it('omits thinking field when empty', async () => {
      const state = new TurnState();
      state.appendText('answer');
      await service.persistAssistantMessage('sid', 'mid-3', state);

      const saved = (repo.saveMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as ChatMessage;
      expect(saved.thinking).toBeUndefined();
    });
  });

  describe('loadHistory', () => {
    it('returns empty array when no messages', async () => {
      const history = await service.loadHistory('sid');
      expect(history).toEqual([]);
    });

    it('converts user messages to LLMMessage format', async () => {
      ({ service, repo } = await buildSessionManager([
        { id: '1', sessionId: 'sid', role: 'user', content: 'hi', createdAt: 1 },
      ]));

      const history = await service.loadHistory('sid');
      expect(history).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('converts assistant messages and includes toolCalls', async () => {
      const toolCalls = [{ id: 'tc-1', name: 'my_tool', args: {} }];
      ({ service } = await buildSessionManager([
        { id: '2', sessionId: 'sid', role: 'assistant', content: 'result', toolCalls, createdAt: 1 },
      ]));

      const history = await service.loadHistory('sid');
      expect(history[0]).toEqual({ role: 'assistant', content: 'result', toolCalls });
    });

    it('REGRESSION: preserves assistant thinking as reasoningContent so context compaction can count it', async () => {
      const toolCalls = [{ id: 'tc-1', name: 'my_tool', args: {} }];
      ({ service } = await buildSessionManager([
        {
          id: '2',
          sessionId: 'sid',
          role: 'assistant',
          content: 'result',
          thinking: 'step 1',
          toolCalls,
          createdAt: 1,
        },
      ]));

      const history = await service.loadHistory('sid');
      expect(history[0]).toMatchObject({
        role: 'assistant',
        content: 'result',
        toolCalls,
        reasoningContent: 'step 1',
      });
    });

    it('hydrates user messages with attachments into multimodal content', async () => {
      const hydrator = {
        hydrate: vi.fn().mockResolvedValue([
          { type: 'image_url', image_url: { url: 'data:image/png;base64,FAKE' } },
        ]),
      };
      ({ service } = await buildSessionManager([
        {
          id: 'u1',
          sessionId: 'sid',
          role: 'user',
          content: 'see this',
          attachments: [{ path: 'uploads/a.png', mimeType: 'image/png' }],
          createdAt: 1,
        },
      ], hydrator));

      const history = await service.loadHistory('sid');
      expect(hydrator.hydrate).toHaveBeenCalledWith('sid', [
        { path: 'uploads/a.png', mimeType: 'image/png' },
      ]);
      expect(history).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'see this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,FAKE' } },
          ],
        },
      ]);
    });

    it('keeps user messages without attachments as plain string content (backwards compat)', async () => {
      const hydrator = { hydrate: vi.fn() };
      ({ service } = await buildSessionManager([
        { id: 'u1', sessionId: 'sid', role: 'user', content: 'plain', createdAt: 1 },
      ], hydrator));

      const history = await service.loadHistory('sid');
      expect(hydrator.hydrate).not.toHaveBeenCalled();
      expect(history[0]).toEqual({ role: 'user', content: 'plain' });
    });

    it('converts tool_result messages to role:tool format', async () => {
      ({ service } = await buildSessionManager([
        { id: '3', sessionId: 'sid', role: 'tool_result', content: '{"ok":true}', toolCallId: 'tc-1', createdAt: 1 },
      ]));

      const history = await service.loadHistory('sid');
      expect(history[0]).toEqual({ role: 'tool', content: '{"ok":true}', toolCallId: 'tc-1' });
    });

    it('REGRESSION: strips inline image data URLs from tool_result history before sending them back to the LLM', async () => {
      ({ service } = await buildSessionManager([
        {
          id: '3',
          sessionId: 'sid',
          role: 'tool_result',
          content: JSON.stringify({
            output_type: 'image',
            image_url: `data:image/png;base64,${'a'.repeat(8_000)}`,
            path: 'images/cat.png',
            download_url: '/api/sessions/sid/vfs/download?path=images%2Fcat.png',
          }),
          toolCallId: 'tc-1',
          createdAt: 1,
        },
      ]));

      const history = await service.loadHistory('sid');
      const toolMessage = history[0];
      expect(toolMessage).toMatchObject({ role: 'tool', toolCallId: 'tc-1' });
      expect(typeof toolMessage?.content).toBe('string');
      expect(toolMessage?.content).toContain('images/cat.png');
      expect(toolMessage?.content).not.toContain('data:image/png;base64');
    });

    it('converts system messages to role:system format', async () => {
      ({ service } = await buildSessionManager([
        { id: '4', sessionId: 'sid', role: 'system', content: 'You are a helpful assistant', createdAt: 1 },
      ]));

      const history = await service.loadHistory('sid');
      expect(history[0]).toEqual({ role: 'system', content: 'You are a helpful assistant' });
    });

    it('returns empty array for unknown role', async () => {
      ({ service } = await buildSessionManager([
        { id: '5', sessionId: 'sid', role: 'unknown_role' as 'user', content: 'test', createdAt: 1 },
      ]));

      const history = await service.loadHistory('sid');
      expect(history).toHaveLength(0);
    });
  });

  describe('loadHistoryForLLM', () => {
    it('REGRESSION: prepends the system prompt and compacts reasoning through the shared context manager', async () => {
      credentialsService.getContextWindowSize.mockResolvedValue(200);
      ({ service } = await buildSessionManager([
        {
          id: '1',
          sessionId: 'sid',
          role: 'assistant',
          content: '',
          thinking: 'x'.repeat(6_000),
          createdAt: 1,
        },
        {
          id: '2',
          sessionId: 'sid',
          role: 'user',
          content: 'latest user prompt',
          createdAt: 2,
        },
      ]));

      const result = await service.loadHistoryForLLM('sid', {
        systemPrompt: 'system prompt',
        toolMetas: [],
      });

      expect(result.unboundedHistoryCount).toBe(3);
      expect(result.history).toEqual([
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'latest user prompt' },
      ]);
    });
  });

  describe('saveToolResult', () => {
    it('saves a tool_result message with correct fields', async () => {
      await service.saveToolResult('sid-1', 'call-abc', '{"result":"ok"}');

      expect(repo.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sid-1',
          role: 'tool_result',
          content: '{"result":"ok"}',
          toolCallId: 'call-abc',
        }),
      );
    });

    it('generates a unique id for each tool result', async () => {
      await service.saveToolResult('sid', 'call-1', 'res');
      await service.saveToolResult('sid', 'call-2', 'res');

      const calls = (repo.saveMessage as ReturnType<typeof vi.fn>).mock.calls;
      const id1 = calls[0][0].id as string;
      const id2 = calls[1][0].id as string;
      expect(id1).not.toBe(id2);
    });
  });

  describe('ensureSession', () => {
    it('delegates to repo.ensureSession', async () => {
      await service.ensureSession('sid-1', 'persona-1');
      expect(repo.ensureSession).toHaveBeenCalledWith('sid-1', 'persona-1');
    });
  });
});
