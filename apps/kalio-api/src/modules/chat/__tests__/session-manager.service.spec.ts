import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { SessionManagerService } from '../session-manager.service';
import { ImageHydratorService } from '../image-hydrator.service';
import { TurnState } from '../turn-state';
import { MESSAGE_REPOSITORY } from '../chat.tokens';
import type { IMessageRepository } from '../interfaces/message-repository.interface';
import type { ChatMessage } from '@kalio/types';

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

  beforeEach(async () => {
    repo = makeRepo();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SessionManagerService,
        { provide: MESSAGE_REPOSITORY, useValue: repo },
        { provide: ImageHydratorService, useValue: { hydrate: vi.fn().mockResolvedValue([]) } },
      ],
    }).compile();
    service = moduleRef.get(SessionManagerService);
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
      repo = makeRepo([
        { id: '1', sessionId: 'sid', role: 'user', content: 'hi', createdAt: 1 },
      ]);
      const moduleRef = await Test.createTestingModule({
        providers: [
          SessionManagerService,
          { provide: MESSAGE_REPOSITORY, useValue: repo },
        { provide: ImageHydratorService, useValue: { hydrate: vi.fn().mockResolvedValue([]) } },
        ],
      }).compile();
      service = moduleRef.get(SessionManagerService);

      const history = await service.loadHistory('sid');
      expect(history).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('converts assistant messages and includes toolCalls', async () => {
      const toolCalls = [{ id: 'tc-1', name: 'my_tool', args: {} }];
      repo = makeRepo([
        { id: '2', sessionId: 'sid', role: 'assistant', content: 'result', toolCalls, createdAt: 1 },
      ]);
      const moduleRef = await Test.createTestingModule({
        providers: [
          SessionManagerService,
          { provide: MESSAGE_REPOSITORY, useValue: repo },
        { provide: ImageHydratorService, useValue: { hydrate: vi.fn().mockResolvedValue([]) } },
        ],
      }).compile();
      service = moduleRef.get(SessionManagerService);

      const history = await service.loadHistory('sid');
      expect(history[0]).toEqual({ role: 'assistant', content: 'result', toolCalls });
    });

    it('hydrates user messages with attachments into multimodal content', async () => {
      repo = makeRepo([
        {
          id: 'u1',
          sessionId: 'sid',
          role: 'user',
          content: 'see this',
          attachments: [{ path: 'uploads/a.png', mimeType: 'image/png' }],
          createdAt: 1,
        },
      ]);
      const hydrator = {
        hydrate: vi.fn().mockResolvedValue([
          { type: 'image_url', image_url: { url: 'data:image/png;base64,FAKE' } },
        ]),
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          SessionManagerService,
          { provide: MESSAGE_REPOSITORY, useValue: repo },
          { provide: ImageHydratorService, useValue: hydrator },
        ],
      }).compile();
      service = moduleRef.get(SessionManagerService);

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
      repo = makeRepo([
        { id: 'u1', sessionId: 'sid', role: 'user', content: 'plain', createdAt: 1 },
      ]);
      const hydrator = { hydrate: vi.fn() };
      const moduleRef = await Test.createTestingModule({
        providers: [
          SessionManagerService,
          { provide: MESSAGE_REPOSITORY, useValue: repo },
          { provide: ImageHydratorService, useValue: hydrator },
        ],
      }).compile();
      service = moduleRef.get(SessionManagerService);

      const history = await service.loadHistory('sid');
      expect(hydrator.hydrate).not.toHaveBeenCalled();
      expect(history[0]).toEqual({ role: 'user', content: 'plain' });
    });

    it('converts tool_result messages to role:tool format', async () => {
      repo = makeRepo([
        { id: '3', sessionId: 'sid', role: 'tool_result', content: '{"ok":true}', toolCallId: 'tc-1', createdAt: 1 },
      ]);
      const moduleRef = await Test.createTestingModule({
        providers: [
          SessionManagerService,
          { provide: MESSAGE_REPOSITORY, useValue: repo },
        { provide: ImageHydratorService, useValue: { hydrate: vi.fn().mockResolvedValue([]) } },
        ],
      }).compile();
      service = moduleRef.get(SessionManagerService);

      const history = await service.loadHistory('sid');
      expect(history[0]).toEqual({ role: 'tool', content: '{"ok":true}', toolCallId: 'tc-1' });
    });
  });
});
