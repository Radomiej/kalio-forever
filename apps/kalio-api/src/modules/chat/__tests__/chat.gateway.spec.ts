import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGateway } from '../chat.gateway';
import type { ToolDispatchService } from '../tool-dispatch.service';
import type { SessionPipelineService } from '../session-pipeline.service';
import type { SessionsService } from '../sessions.service';
import type { RAAppHITLService, SavedApproval } from '../../raapp/raapp-hitl.service';
import type { AgentFlowRunSnapshot, ToolConfirmationRequest } from '@kalio/types';
import type { AgentFlowRuntimePort } from '../../agent-flow/agent-flow-runtime.port';
import type { CLIAgentSessionRuntimePort } from '../../cli-agent/cli-agent-session-runtime.port';

type ConfirmHandler = (client: never, payload: { requestId: string; sessionId: string; message?: string }) => void;

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let toolDispatch: ToolDispatchService;
  let pipeline: SessionPipelineService;
  let sessions: SessionsService;
  let raappHITL: RAAppHITLService;
  let agentFlowRuntime: AgentFlowRuntimePort;
  let cliAgentSessionRuntime: CLIAgentSessionRuntimePort;
  let client: { id: string; emit: ReturnType<typeof vi.fn> };
  let observer: { id: string; emit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    toolDispatch = {
      resolveConfirmation: vi.fn(),
      cancelConfirmation: vi.fn(),
      getPendingConfirmations: vi.fn().mockReturnValue([]),
    } as unknown as ToolDispatchService;

    pipeline = {
      submit: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      abortAll: vi.fn(),
      getSessionStatus: vi.fn().mockReturnValue({ sessionId: 'session-1', active: false, queueLength: 0 }),
      getSessionStatusWithRun: vi.fn().mockResolvedValue({ sessionId: 'session-1', active: false, queueLength: 0 }),
    } as unknown as SessionPipelineService;

    sessions = {
      listChildren: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({
        id: 'child-session',
        personaId: 'default',
        title: 'Child',
        createdAt: 1,
        updatedAt: 1,
      }),
    } as unknown as SessionsService;

    raappHITL = {
      executeApproved: vi.fn(),
      cancelApprovals: vi.fn(),
      getPendingForSession: vi.fn(),
    } as unknown as RAAppHITLService;

    agentFlowRuntime = {
      findAll: vi.fn().mockResolvedValue([]),
      stop: vi.fn().mockResolvedValue(null),
      run: vi.fn(),
    } as unknown as AgentFlowRuntimePort;

    cliAgentSessionRuntime = {
      stopSession: vi.fn().mockResolvedValue({
        childSessionId: 'cli-child-1',
        parentSessionId: 'session-1',
        agentId: 'codex',
        workdir: 'C:/repo',
        status: 'stopped',
        lastPrompt: 'task',
        updatedAt: Date.now(),
      }),
    } as unknown as CLIAgentSessionRuntimePort;

    client = {
      id: 'socket-1',
      emit: vi.fn(),
    };
    observer = {
      id: 'socket-2',
      emit: vi.fn(),
    };

    gateway = new ChatGateway(toolDispatch, pipeline, raappHITL, sessions, agentFlowRuntime, cliAgentSessionRuntime);
    gateway.handleConnection(client as never);
    gateway.handleConnection(observer as never);
    (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions
      .get(client.id)
      ?.add('session-1');
  });

  it('broadcasts child-session stream events to sockets that identified that child session', async () => {
    await gateway.handleSessionIdentify(observer as never, { sessionId: 'child-session' });
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

  it('REGRESSION: allows the initiator to stop a child session after child events were streamed to that socket', async () => {
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

    await gateway.handleChatStop(client as never, { sessionId: 'child-session' });

    expect((pipeline.stop as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('child-session');
  });

  it('does not delegate chat:stop to CLI runtime for non-cli-agent sessions', async () => {
    vi.mocked(sessions.get).mockResolvedValue({
      id: 'session-1',
      personaId: 'default',
      title: 'Parent chat',
      createdAt: 1,
      updatedAt: 1,
    });

    await gateway.handleChatStop(client as never, { sessionId: 'session-1' });

    expect(cliAgentSessionRuntime.stopSession).not.toHaveBeenCalled();
  });

  it('forwards terminal tool:result from cli stopSession emit to the initiating socket', async () => {
    vi.mocked(sessions.get).mockResolvedValue({
      id: 'cli-child-1',
      personaId: 'default',
      title: 'codex CLI',
      kind: 'cli-agent',
      parentSessionId: 'session-1',
      parentToolCallId: 'call-cli-1',
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(cliAgentSessionRuntime.stopSession).mockImplementation(async (_parent, _child, emit) => {
      emit?.('tool:result', {
        callId: 'call-cli-1',
        toolName: 'run_cli_agent',
        sessionId: 'cli-child-1',
        status: 'cancelled',
      });
      emit?.('agent:done', { sessionId: 'cli-child-1', turnId: 'cli-turn-call-cli-1' });
      return {
        childSessionId: 'cli-child-1',
        parentSessionId: 'session-1',
        agentId: 'codex',
        workdir: 'C:/repo',
        status: 'stopped',
        lastPrompt: 'task',
        updatedAt: Date.now(),
      };
    });
    (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions
      .get(client.id)
      ?.add('cli-child-1');

    await gateway.handleChatStop(client as never, { sessionId: 'cli-child-1' });

    expect(client.emit).toHaveBeenCalledWith(
      'tool:result',
      expect.objectContaining({
        sessionId: 'cli-child-1',
        status: 'cancelled',
      }),
    );
    expect(client.emit).toHaveBeenCalledWith(
      'agent:done',
      expect.objectContaining({ sessionId: 'cli-child-1' }),
    );
  });

  it('delegates chat:stop on cli-agent child sessions to CLIAgentSessionRuntimeService', async () => {
    vi.mocked(sessions.get).mockResolvedValue({
      id: 'cli-child-1',
      personaId: 'default',
      title: 'codex CLI',
      kind: 'cli-agent',
      parentSessionId: 'session-1',
      parentToolCallId: 'call-cli-1',
      createdAt: 1,
      updatedAt: 1,
    });
    (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions
      .get(client.id)
      ?.add('cli-child-1');

    await gateway.handleChatStop(client as never, { sessionId: 'cli-child-1' });

    expect(cliAgentSessionRuntime.stopSession).toHaveBeenCalledWith(
      'session-1',
      'cli-child-1',
      expect.any(Function),
    );
    expect((pipeline.stop as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('cli-child-1');
  });

  it('REGRESSION: child-session stream events do not grant tool confirmation rights to the initiator', async () => {
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

    const handleToolConfirm = (gateway as unknown as { handleToolConfirm: ConfirmHandler }).handleToolConfirm.bind(gateway);
    handleToolConfirm(client as never, { requestId: 'req-child', sessionId: 'child-session' });

    expect(toolDispatch.resolveConfirmation).not.toHaveBeenCalled();
  });

  it('REGRESSION: emitToInitiatorAndSessionSubscribers does not re-subscribe a disconnected socket', () => {
    gateway.handleDisconnect(client as never);

    const emitToInitiatorAndSessionSubscribers = (gateway as unknown as {
      emitToInitiatorAndSessionSubscribers: <K extends keyof import('@kalio/types').SocketEvents>(
        initiatorSocketId: string,
        fallbackSessionId: string,
        event: K,
        data: import('@kalio/types').SocketEvents[K],
      ) => void;
    }).emitToInitiatorAndSessionSubscribers.bind(gateway);

    emitToInitiatorAndSessionSubscribers('socket-1', 'session-1', 'chat:chunk', {
      sessionId: 'child-session',
      messageId: 'msg-child-1',
      delta: 'child says hello',
      done: false,
    });

    const socketSessions = (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions;
    const sessionSubscribers = (gateway as unknown as { sessionSubscribers: Map<string, Set<string>> }).sessionSubscribers;

    expect(socketSessions.has('socket-1')).toBe(false);
    expect(sessionSubscribers.get('child-session')?.has('socket-1')).not.toBe(true);
  });

  it('REGRESSION: stopping a parent session also stops its child subagent sessions', async () => {
    (sessions.listChildren as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'child-session' }])
      .mockResolvedValueOnce([]);

    await gateway.handleChatStop(client as never, { sessionId: 'session-1' });

    expect((pipeline.stop as ReturnType<typeof vi.fn>)).toHaveBeenNthCalledWith(1, 'session-1');
    expect((pipeline.stop as ReturnType<typeof vi.fn>)).toHaveBeenNthCalledWith(2, 'child-session');
  });

  it('REGRESSION: stopping a parent session delegates descendant cli-agent children through the CLI runtime', async () => {
    (sessions.listChildren as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'cli-child-1' }])
      .mockResolvedValueOnce([]);
    vi.mocked(sessions.get).mockImplementation(async (sessionId: string) => {
      if (sessionId === 'cli-child-1') {
        return {
          id: 'cli-child-1',
          personaId: 'default',
          title: 'codex CLI',
          kind: 'cli-agent',
          parentSessionId: 'session-1',
          parentToolCallId: 'call-cli-1',
          createdAt: 1,
          updatedAt: 1,
        };
      }

      return {
        id: 'session-1',
        personaId: 'default',
        title: 'Parent chat',
        createdAt: 1,
        updatedAt: 1,
      };
    });
    vi.mocked(cliAgentSessionRuntime.stopSession).mockImplementation(async (_parent, _child, emit) => {
      emit?.('tool:result', {
        callId: 'call-cli-1',
        toolName: 'run_cli_agent',
        sessionId: 'cli-child-1',
        status: 'cancelled',
      });
      emit?.('agent:done', { sessionId: 'cli-child-1', turnId: 'cli-turn-call-cli-1' });
      return {
        childSessionId: 'cli-child-1',
        parentSessionId: 'session-1',
        agentId: 'codex',
        workdir: 'C:/repo',
        status: 'stopped',
        lastPrompt: 'task',
        updatedAt: Date.now(),
      };
    });
    (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions
      .get(client.id)
      ?.add('cli-child-1');

    await gateway.handleChatStop(client as never, { sessionId: 'session-1' });

    expect(cliAgentSessionRuntime.stopSession).toHaveBeenCalledWith(
      'session-1',
      'cli-child-1',
      expect.any(Function),
    );
    expect((pipeline.stop as ReturnType<typeof vi.fn>)).toHaveBeenNthCalledWith(1, 'session-1');
    expect((pipeline.stop as ReturnType<typeof vi.fn>)).toHaveBeenNthCalledWith(2, 'cli-child-1');
    expect(client.emit).toHaveBeenCalledWith(
      'tool:result',
      expect.objectContaining({
        sessionId: 'cli-child-1',
        status: 'cancelled',
      }),
    );
    expect(client.emit).toHaveBeenCalledWith(
      'agent:done',
      expect.objectContaining({ sessionId: 'cli-child-1' }),
    );
  });

  it('REGRESSION: stopping a parent session cascades to active AgentFlow runs', async () => {
    const snapshot: AgentFlowRunSnapshot = {
      run: {
        id: 'flow-run-1',
        parentSessionId: 'session-1',
        childSessionId: 'arch-flow-run-1-root',
        openChatSessionId: 'arch-flow-run-1-root',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    };
    (agentFlowRuntime.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([snapshot]);

    await gateway.handleChatStop(client as never, { sessionId: 'session-1' });

    expect(agentFlowRuntime.stop).toHaveBeenCalledWith('flow-run-1');
  });

  it('REGRESSION: stopping an AgentFlow child session cascades to the matching AgentFlow run', async () => {
    const snapshot: AgentFlowRunSnapshot = {
      run: {
        id: 'flow-run-child',
        parentSessionId: 'parent-session',
        childSessionId: 'arch-flow-run-child-root',
        openChatSessionId: 'arch-flow-run-child-root',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    };
    (agentFlowRuntime.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([snapshot]);
    (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions
      .get(client.id)
      ?.add('arch-flow-run-child-root');

    await gateway.handleChatStop(client as never, { sessionId: 'arch-flow-run-child-root' });

    expect(agentFlowRuntime.stop).toHaveBeenCalledWith('flow-run-child');
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
    it('adds session to existing socket set', async () => {
      await gateway.handleSessionIdentify(client as never, { sessionId: 'session-2' });
      const sessions = (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions;
      expect(sessions.get(client.id)?.has('session-2')).toBe(true);
    });

    it('REGRESSION: creates Set and registers session when socket entry is missing', async () => {
      // Simulate edge case: socketSessions entry was removed (e.g. race with handleDisconnect)
      const sessions = (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions;
      sessions.delete(client.id);

      // Must not silently fail — should create Set and register the session
      await gateway.handleSessionIdentify(client as never, { sessionId: 'session-reconnect' });

      const registered = sessions.get(client.id);
      expect(registered).toBeTruthy();
      expect(registered?.has('session-reconnect')).toBe(true);
    });

    it('REGRESSION: replays pending tool confirmations for the re-identified session', async () => {
      const pending: ToolConfirmationRequest = {
        requestId: 'req-1',
        toolCallId: 'call-1',
        sessionId: 'session-2',
        toolName: 'image_generate',
        args: { filename: 'coffee-hero.png' },
        timeoutMs: 600000,
      };
      (toolDispatch.getPendingConfirmations as ReturnType<typeof vi.fn>).mockReturnValue([pending]);

      await gateway.handleSessionIdentify(client as never, { sessionId: 'session-2' });

      expect(client.emit).toHaveBeenCalledWith('tool:confirmation_required', pending);
    });

    it('REGRESSION: replays active runtime status for the re-identified session', async () => {
      (pipeline.getSessionStatusWithRun as ReturnType<typeof vi.fn>).mockResolvedValue({
        sessionId: 'session-2',
        active: true,
        turnId: 'turn-live',
        queueLength: 2,
      });

      await gateway.handleSessionIdentify(client as never, { sessionId: 'session-2' });

      expect(client.emit).toHaveBeenCalledWith('session:status', {
        sessionId: 'session-2',
        active: true,
        turnId: 'turn-live',
        queueLength: 2,
      });
    });

    it('REGRESSION: re-identifying the master session replays child confirmations and lets the socket confirm them', async () => {
      const pending: ToolConfirmationRequest = {
        requestId: 'req-child',
        toolCallId: 'call-child',
        sessionId: 'child-session',
        toolName: 'image_generate',
        args: { filename: 'coffee-hero.png' },
        timeoutMs: 600000,
      };
      (sessions.listChildren as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{ id: 'child-session' }])
        .mockResolvedValueOnce([]);
      (toolDispatch.getPendingConfirmations as ReturnType<typeof vi.fn>).mockImplementation((sessionId: string) => {
        if (sessionId === 'child-session') {
          return [pending];
        }
        return [];
      });

      await gateway.handleSessionIdentify(client as never, { sessionId: 'session-1' });

      expect(client.emit).toHaveBeenCalledWith('tool:confirmation_required', pending);

      const handleToolConfirm = (gateway as unknown as { handleToolConfirm: ConfirmHandler }).handleToolConfirm.bind(gateway);
      handleToolConfirm(client as never, { requestId: 'req-child', sessionId: 'child-session' });

      expect(toolDispatch.resolveConfirmation).toHaveBeenCalledWith('req-child', 'child-session');
    });
  });

  describe('tool confirmations', () => {
    it('rejects tool confirm when socket does not own the session', () => {
      const handleToolConfirm = (gateway as unknown as { handleToolConfirm: ConfirmHandler }).handleToolConfirm.bind(gateway);

      handleToolConfirm(observer as never, { requestId: 'req-1', sessionId: 'session-1' });

      expect(toolDispatch.resolveConfirmation).not.toHaveBeenCalled();
    });

    it('passes tool confirm through for an owned session', () => {
      const handleToolConfirm = (gateway as unknown as { handleToolConfirm: ConfirmHandler }).handleToolConfirm.bind(gateway);

      handleToolConfirm(client as never, { requestId: 'req-1', sessionId: 'session-1' });

      expect(toolDispatch.resolveConfirmation).toHaveBeenCalledWith('req-1', 'session-1');
    });

    it('passes optional confirmation message through for an owned session', () => {
      const handleToolConfirm = (gateway as unknown as { handleToolConfirm: ConfirmHandler }).handleToolConfirm.bind(gateway);

      handleToolConfirm(client as never, {
        requestId: 'req-1',
        sessionId: 'session-1',
        message: 'Looks safe, continue.',
      });

      expect(toolDispatch.resolveConfirmation).toHaveBeenCalledWith('req-1', 'session-1', 'Looks safe, continue.');
    });

    it('rejects tool cancel when socket does not own the session', () => {
      const handleToolCancel = (gateway as unknown as { handleToolCancel: ConfirmHandler }).handleToolCancel.bind(gateway);

      handleToolCancel(observer as never, { requestId: 'req-1', sessionId: 'session-1' });

      expect(toolDispatch.cancelConfirmation).not.toHaveBeenCalled();
    });

    it('passes tool cancel through for an owned session', () => {
      const handleToolCancel = (gateway as unknown as { handleToolCancel: ConfirmHandler }).handleToolCancel.bind(gateway);

      handleToolCancel(client as never, { requestId: 'req-1', sessionId: 'session-1' });

      expect(toolDispatch.cancelConfirmation).toHaveBeenCalledWith('req-1', 'session-1');
    });

    it('passes optional rejection message through for an owned session', () => {
      const handleToolCancel = (gateway as unknown as { handleToolCancel: ConfirmHandler }).handleToolCancel.bind(gateway);

      handleToolCancel(client as never, {
        requestId: 'req-1',
        sessionId: 'session-1',
        message: 'Do not write files; explain the plan instead.',
      });

      expect(toolDispatch.cancelConfirmation).toHaveBeenCalledWith(
        'req-1',
        'session-1',
        'Do not write files; explain the plan instead.',
      );
    });
  });
});
