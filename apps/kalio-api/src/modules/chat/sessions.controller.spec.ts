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
    update: vi.fn().mockResolvedValue(undefined),
    generateTitle: vi.fn().mockResolvedValue({ title: 'Generated Title' }),
  };
}

describe('SessionsController', () => {
  let controller: SessionsController;
  let svc: ReturnType<typeof makeService>;

  beforeEach(() => {
    svc = makeService();
    controller = new SessionsController(svc as never);
  });

  describe('list()', () => {
    it('returns all sessions', async () => {
      const result = await controller.list();
      expect(svc.list).toHaveBeenCalled();
      expect(result).toEqual([mockSession]);
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

  describe('delete()', () => {
    it('deletes a session', async () => {
      await controller.delete('sess-1');
      expect(svc.delete).toHaveBeenCalledWith('sess-1');
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
