import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionsController } from './sessions.controller';
import type { ChatSession, ChatMessage } from '@kalio/types';

const mockSession: ChatSession = {
  id: 'sess-1',
  personaId: 'persona-1',
  title: 'Test Session',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockMessage: ChatMessage = {
  id: 'msg-1',
  sessionId: 'sess-1',
  role: 'user',
  content: 'Hello',
  createdAt: Date.now(),
};

function makeService() {
  return {
    list: vi.fn().mockResolvedValue([mockSession]),
    create: vi.fn().mockResolvedValue(mockSession),
    getMessages: vi.fn().mockResolvedValue([mockMessage]),
    delete: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    generateTitle: vi.fn().mockResolvedValue({ title: 'Generated Title' }),
  };
}

function makeRunJournal() {
  return {
    getCurrentRun: vi.fn().mockResolvedValue(null),
  };
}

function makeContextPreviewService() {
  return {
    buildPreview: vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      personaId: 'persona-1',
      model: 'test-model',
      contextLimit: 32000,
      estimatedTokens: {
        total: 12,
        systemPrompt: 2,
        tools: 1,
        history: 9,
        images: 0,
        reasoning: 0,
      },
      compaction: {
        applied: false,
        unboundedMessageCount: 2,
        finalMessageCount: 2,
        safeTargetTokens: 25600,
      },
      effectiveSystemPrompt: 'system',
      tools: [],
      messages: [],
    }),
  };
}

describe('SessionsController', () => {
  let controller: SessionsController;
  let svc: ReturnType<typeof makeService>;
  let runJournal: ReturnType<typeof makeRunJournal>;
  let contextPreview: ReturnType<typeof makeContextPreviewService>;

  beforeEach(() => {
    svc = makeService();
    runJournal = makeRunJournal();
    contextPreview = makeContextPreviewService();
    controller = new SessionsController(svc as never, runJournal as never, contextPreview as never);
  });

  describe('list()', () => {
    it('returns all sessions', async () => {
      const result = await controller.list();
      expect(svc.list).toHaveBeenCalledWith({ includeArchived: false });
      expect(result).toEqual([mockSession]);
    });

    it('passes includeArchived through to the service', async () => {
      await controller.list('true');
      expect(svc.list).toHaveBeenCalledWith({ includeArchived: true });
    });
  });

  describe('create()', () => {
    it('creates a session with dto', async () => {
      const dto = { personaId: 'persona-1', title: 'New Session' };
      const result = await controller.create(dto);
      expect(svc.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockSession);
    });
  });

  describe('getMessages()', () => {
    it('returns messages for a session', async () => {
      const result = await controller.getMessages('sess-1');
      expect(svc.getMessages).toHaveBeenCalledWith('sess-1');
      expect(result).toEqual([mockMessage]);
    });
  });

  describe('getCurrentRun()', () => {
    it('returns current run for a session', async () => {
      runJournal.getCurrentRun.mockResolvedValueOnce({
        id: 'run-1',
        sessionId: 'sess-1',
        turnId: 'turn-1',
        phase: 'llm_streaming',
        status: 'interrupted_needs_retry',
        retryCount: 0,
        safeResume: true,
        startedAt: 1,
        updatedAt: 2,
        lastHeartbeatAt: 2,
      });

      const result = await controller.getCurrentRun('sess-1');

      expect(runJournal.getCurrentRun).toHaveBeenCalledWith('sess-1');
      expect(result).toMatchObject({ id: 'run-1', safeResume: true });
    });
  });

  describe('getContextPreview()', () => {
    it('delegates preview building to context preview service', async () => {
      const request = { personaId: 'persona-1', draftUserMessage: 'draft' };
      const result = await controller.getContextPreview('sess-1', request);

      expect(contextPreview.buildPreview).toHaveBeenCalledWith('sess-1', {
        ...request,
        target: 'session',
        sessionId: 'sess-1',
      });
      expect(result.sessionId).toBe('sess-1');
    });
  });

  describe('delete()', () => {
    it('deletes a session', async () => {
      await controller.delete('sess-1');
      expect(svc.delete).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('archive()', () => {
    it('archives a session without hard deletion', async () => {
      await controller.archive('sess-1');
      expect(svc.archive).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('restore()', () => {
    it('restores an archived session', async () => {
      await controller.restore('sess-1');
      expect(svc.restore).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('update()', () => {
    it('updates a session title', async () => {
      await controller.update('sess-1', { title: 'New Title' });
      expect(svc.update).toHaveBeenCalledWith('sess-1', { title: 'New Title' });
    });

    it('updates a session personaId', async () => {
      await controller.update('sess-1', { personaId: 'builder' });
      expect(svc.update).toHaveBeenCalledWith('sess-1', { personaId: 'builder' });
    });
  });

  describe('generateTitle()', () => {
    it('returns generated title', async () => {
      const result = await controller.generateTitle('sess-1');
      expect(svc.generateTitle).toHaveBeenCalledWith('sess-1');
      expect(result).toEqual({ title: 'Generated Title' });
    });
  });
});
