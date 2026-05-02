import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGateway } from '../chat.gateway';
import type { ToolDispatchService } from '../tool-dispatch.service';
import type { SessionPipelineService } from '../session-pipeline.service';
import type { RAAppHITLService, SavedApproval } from '../../raapp/raapp-hitl.service';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let toolDispatch: ToolDispatchService;
  let pipeline: SessionPipelineService;
  let raappHITL: RAAppHITLService;
  let client: { id: string; emit: ReturnType<typeof vi.fn> };
  let observer: { id: string; emit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    toolDispatch = {
      resolveConfirmation: vi.fn(),
      cancelConfirmation: vi.fn(),
    } as unknown as ToolDispatchService;

    pipeline = {
      submit: vi.fn().mockResolvedValue(undefined),
      abortAll: vi.fn(),
    } as unknown as SessionPipelineService;

    raappHITL = {
      executeApproved: vi.fn(),
      cancelApprovals: vi.fn(),
      getPendingForSession: vi.fn(),
    } as unknown as RAAppHITLService;

    client = {
      id: 'socket-1',
      emit: vi.fn(),
    };
    observer = {
      id: 'socket-2',
      emit: vi.fn(),
    };

    gateway = new ChatGateway(toolDispatch, pipeline, raappHITL);
    gateway.handleConnection(client as never);
    gateway.handleConnection(observer as never);
    (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions
      .get(client.id)
      ?.add('session-1');
  });

  it('broadcasts child-session stream events to sockets that identified that child session', async () => {
    gateway.handleSessionIdentify(observer as never, { sessionId: 'child-session' });
    (pipeline.submit as ReturnType<typeof vi.fn>).mockImplementation(async (_payload, emit) => {
      emit('chat:chunk', {
        sessionId: 'child-session',
        messageId: 'msg-child-1',
        delta: 'child says hello',
        done: false,
      });
    });

    await gateway.handleChatSend(client as never, {
      sessionId: 'session-1',
      content: 'delegate this task',
      personaId: 'default',
    });

    expect(client.emit).toHaveBeenCalledWith('chat:chunk', expect.objectContaining({ sessionId: 'child-session' }));
    expect(observer.emit).toHaveBeenCalledWith('chat:chunk', expect.objectContaining({ sessionId: 'child-session' }));
  });

  it('emits cancelled RA-App results with the original toolCallId and system metadata', async () => {
    const pending: SavedApproval[] = [
      {
        id: 'req-1',
        sessionId: 'session-1',
        toolCallId: 'tool-123',
        system: 'vfs_write',
        args: { path: 'out.txt' },
        displayLabel: 'Write file',
        status: 'pending',
        createdAt: new Date(),
      },
      {
        id: 'req-2',
        sessionId: 'session-1',
        toolCallId: 'tool-123',
        system: 'vfs_delete',
        args: { path: 'tmp.txt' },
        displayLabel: 'Delete file',
        status: 'pending',
        createdAt: new Date(),
      },
    ];

    (raappHITL.getPendingForSession as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    (raappHITL.cancelApprovals as ReturnType<typeof vi.fn>).mockResolvedValue({ toolCallId: 'tool-123' });

    await gateway.handleRaAppCancel(client as never, {
      requestIds: ['req-1', 'req-2'],
      sessionId: 'session-1',
    });

    expect(client.emit).toHaveBeenCalledWith('raapp:native_result', {
      toolCallId: 'tool-123',
      sessionId: 'session-1',
      results: [
        { id: 'req-1', system: 'vfs_write', status: 'cancelled' },
        { id: 'req-2', system: 'vfs_delete', status: 'cancelled' },
      ],
    });
  });

  describe('handleSessionIdentify', () => {
    it('adds session to existing socket set', () => {
      gateway.handleSessionIdentify(client as never, { sessionId: 'session-2' });
      const sessions = (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions;
      expect(sessions.get(client.id)?.has('session-2')).toBe(true);
    });

    it('REGRESSION: creates Set and registers session when socket entry is missing', () => {
      // Simulate edge case: socketSessions entry was removed (e.g. race with handleDisconnect)
      const sessions = (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions;
      sessions.delete(client.id);

      // Must not silently fail — should create Set and register the session
      gateway.handleSessionIdentify(client as never, { sessionId: 'session-reconnect' });

      const registered = sessions.get(client.id);
      expect(registered).toBeTruthy();
      expect(registered?.has('session-reconnect')).toBe(true);
    });
  });
});