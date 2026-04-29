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

    gateway = new ChatGateway(toolDispatch, pipeline, raappHITL);
    gateway.handleConnection(client as never);
    (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions
      .get(client.id)
      ?.add('session-1');
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
});