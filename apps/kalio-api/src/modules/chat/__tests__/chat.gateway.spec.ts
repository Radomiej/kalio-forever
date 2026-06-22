import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGateway } from '../chat.gateway';
import type { ToolDispatchService } from '../tool-dispatch.service';
import type { SessionPipelineService } from '../session-pipeline.service';
import type { SessionsService } from '../sessions.service';
import type { RAAppHITLService, SavedApproval } from '../../raapp/raapp-hitl.service';
import type { AgentFlowRunSnapshot, ChatSession, ToolConfirmationRequest } from '@kalio/types';
import type { AgentFlowRuntimePort } from '../../agent-flow/agent-flow-runtime.port';
import { CLI_AGENT_SESSION_RUNTIME } from '../../cli-agent/cli-agent-session-runtime.port';
import type { CLIAgentSessionRuntimePort } from '../../cli-agent/cli-agent-session-runtime.port';
import type { SessionEventsService } from '../session-events.service';
import type { AgentBudgetApprovalService } from '../agent-budget-approval.service';
import type { ModuleRef } from '@nestjs/core';

type ConfirmHandler = (client: never, payload: { requestId: string; sessionId: string; message?: string }) => void;
type SessionCreatedHandler = (event: { session: ChatSession }) => void;
type SessionUpdatedHandler = (event: { session: ChatSession }) => void;

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let toolDispatch: ToolDispatchService;
  let pipeline: SessionPipelineService;
  let sessions: SessionsService;
  let raappHITL: RAAppHITLService;
  let agentFlowRuntime: AgentFlowRuntimePort;
  let cliAgentSessionRuntime: CLIAgentSessionRuntimePort;
  let sessionEvents: SessionEventsService;
  let agentBudgetApprovals: AgentBudgetApprovalService;
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
      stopAndDrain: vi.fn().mockResolvedValue(undefined),
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

    sessionEvents = {
      onSessionCreated: vi.fn().mockReturnValue(() => undefined),
      onSessionUpdated: vi.fn().mockReturnValue(() => undefined),
      emitSessionCreated: vi.fn(),
      emitSessionUpdated: vi.fn(),
    } as unknown as SessionEventsService;
    agentBudgetApprovals = {
      getPendingApprovals: vi.fn().mockReturnValue([]),
      isSyntheticPendingApproval: vi.fn().mockReturnValue(false),
      resolveApproval: vi.fn().mockReturnValue('resolved'),
    } as unknown as AgentBudgetApprovalService;

    client = {
      id: 'socket-1',
      emit: vi.fn(),
    };
    observer = {
      id: 'socket-2',
      emit: vi.fn(),
    };

    gateway = new ChatGateway(toolDispatch, pipeline, raappHITL, sessions, sessionEvents, agentBudgetApprovals, agentFlowRuntime, cliAgentSessionRuntime);
    gateway.handleConnection(client as never);
    gateway.handleConnection(observer as never);
    (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions
      .get(client.id)
      ?.add('session-1');
  });

  function createdHandler(): SessionCreatedHandler {
    return vi.mocked(sessionEvents.onSessionCreated).mock.calls[0]?.[0] as SessionCreatedHandler;
  }

  function updatedHandler(): SessionUpdatedHandler {
    return vi.mocked(sessionEvents.onSessionUpdated).mock.calls[0]?.[0] as SessionUpdatedHandler;
  }

  function sessionFixture(overrides: Partial<ChatSession>): ChatSession {
    return {
      id: 'session-fixture',
      personaId: 'default',
      title: 'Session fixture',
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    };
  }

  async function flushLifecycleBroadcast(): Promise<void> {
    await (gateway as unknown as { sessionLifecycleBroadcastQueue?: Promise<void> }).sessionLifecycleBroadcastQueue;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

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

    expect((pipeline.stopAndDrain as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('child-session');
  });

  it('REGRESSION: chat:stop drains the root and descendant sessions before reporting terminal status', async () => {
    (sessions.listChildren as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'child-session' }])
      .mockResolvedValueOnce([]);

    await gateway.handleChatStop(client as never, { sessionId: 'session-1' });

    expect(pipeline.stopAndDrain).toHaveBeenCalledWith('session-1');
    expect(pipeline.stopAndDrain).toHaveBeenCalledWith('child-session');
    expect(pipeline.stop).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith(
      'session:runtime_snapshot',
      expect.objectContaining({
        sessionId: 'session-1',
        active: false,
      }),
    );
  });

  it('uses one collected session tree during chat:stop instead of rebuilding descendants per snapshot', async () => {
    (sessions.listChildren as ReturnType<typeof vi.fn>)
      .mockImplementation(async (sessionId: string) => (
        sessionId === 'session-1' ? [{ id: 'child-session' }] : []
      ));
    (pipeline.getSessionStatusWithRun as ReturnType<typeof vi.fn>).mockImplementation(async (sessionId: string) => ({
      sessionId,
      active: false,
      queueLength: 0,
    }));

    await gateway.handleChatStop(client as never, { sessionId: 'session-1' });

    expect(sessions.listChildren).toHaveBeenCalledTimes(2);
    expect(pipeline.getSessionStatusWithRun).toHaveBeenCalledTimes(2);
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
    expect(client.emit.mock.calls.filter(([event]) => event === 'tool:result').length).toBe(1);
    expect(client.emit.mock.calls.filter(([event]) => event === 'agent:done').length).toBe(1);
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
    expect((pipeline.stopAndDrain as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('cli-child-1');
  });

  it('falls back to ModuleRef for CLI runtime lookup when the constructor token is absent', async () => {
    const moduleRef = {
      get: vi.fn().mockImplementation((token: unknown) => {
        if (token === CLI_AGENT_SESSION_RUNTIME) {
          return cliAgentSessionRuntime;
        }
        return undefined;
      }),
    } as unknown as ModuleRef;
    gateway = new ChatGateway(
      toolDispatch,
      pipeline,
      raappHITL,
      sessions,
      sessionEvents,
      agentBudgetApprovals,
      agentFlowRuntime,
      undefined,
      moduleRef,
    );
    gateway.handleConnection(client as never);
    (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions
      .get(client.id)
      ?.add('session-1');
      (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions
      .get(client.id)
      ?.add('cli-child-1');
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

    await gateway.handleChatStop(client as never, { sessionId: 'cli-child-1' });

    expect(moduleRef.get).toHaveBeenCalledWith(CLI_AGENT_SESSION_RUNTIME, { strict: false });
    expect(cliAgentSessionRuntime.stopSession).toHaveBeenCalledWith(
      'session-1',
      'cli-child-1',
      expect.any(Function),
    );
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

  it('REGRESSION: emits grandchild session lifecycle events to ancestor session subscribers', async () => {
    const host = sessionFixture({ id: 'host-session', title: 'Host' });
    const root = sessionFixture({ id: 'arch-run-root', title: 'Architecture root', parentSessionId: host.id });
    const branch = sessionFixture({
      id: 'arch-run-pragmatist',
      title: 'Architecture: Pragmatist',
      kind: 'subagent',
      parentSessionId: root.id,
    });
    vi.mocked(sessions.get).mockImplementation(async (sessionId: string) => {
      if (sessionId === host.id) return host;
      if (sessionId === root.id) return root;
      if (sessionId === branch.id) return branch;
      throw new Error(`Unknown session ${sessionId}`);
    });

    await gateway.handleSessionIdentify(client as never, { sessionId: host.id });
    client.emit.mockClear();

    createdHandler()({ session: root });
    createdHandler()({ session: branch });
    updatedHandler()({ session: { ...branch, title: 'Architecture: Pragmatist updated', updatedAt: 2 } });
    await flushLifecycleBroadcast();

    expect(client.emit).toHaveBeenCalledWith('session:created', expect.objectContaining({ id: root.id }));
    expect(client.emit).toHaveBeenCalledWith('session:created', expect.objectContaining({ id: branch.id }));
    expect(client.emit).toHaveBeenCalledWith('session:updated', expect.objectContaining({ id: branch.id }));
  });

  it('REGRESSION: preserves session lifecycle ordering for a grandchild branch when ancestor lookup is slow', async () => {
    const host = sessionFixture({ id: 'host-session', title: 'Host' });
    const root = sessionFixture({ id: 'arch-run-root', title: 'Architecture root', parentSessionId: host.id });
    const branch = sessionFixture({
      id: 'arch-run-pragmatist',
      title: 'Architecture: Pragmatist',
      kind: 'subagent',
      parentSessionId: root.id,
    });
    let rootLookupCount = 0;
    let releaseFirstRootLookup: (() => void) | undefined;
    vi.mocked(sessions.get).mockImplementation(async (sessionId: string) => {
      if (sessionId === root.id) {
        rootLookupCount += 1;
        if (rootLookupCount === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstRootLookup = resolve;
          });
        }
        return root;
      }
      if (sessionId === host.id) return host;
      if (sessionId === branch.id) return branch;
      throw new Error(`Unknown session ${sessionId}`);
    });

    await gateway.handleSessionIdentify(client as never, { sessionId: host.id });
    client.emit.mockClear();

    createdHandler()({ session: branch });
    updatedHandler()({ session: { ...branch, title: 'Architecture: Pragmatist updated', updatedAt: 2 } });
    for (let attempt = 0; attempt < 10 && !releaseFirstRootLookup; attempt += 1) {
      await Promise.resolve();
    }
    expect(releaseFirstRootLookup).toBeTypeOf('function');
    releaseFirstRootLookup?.();
    await flushLifecycleBroadcast();

    const branchLifecycleEvents = client.emit.mock.calls
      .filter(([event, payload]) =>
        (event === 'session:created' || event === 'session:updated')
        && typeof payload === 'object'
        && payload !== null
        && (payload as ChatSession).id === branch.id)
      .map(([event]) => event);

    expect(branchLifecycleEvents).toEqual(['session:created', 'session:updated']);
  });

  it('REGRESSION: emits a lifecycle event once when a socket subscribes to both parent and child root', async () => {
    const host = sessionFixture({ id: 'host-session', title: 'Host' });
    const root = sessionFixture({ id: 'arch-run-root', title: 'Architecture root', parentSessionId: host.id });
    const branch = sessionFixture({
      id: 'arch-run-pragmatist',
      title: 'Architecture: Pragmatist',
      kind: 'subagent',
      parentSessionId: root.id,
    });
    vi.mocked(sessions.get).mockImplementation(async (sessionId: string) => {
      if (sessionId === host.id) return host;
      if (sessionId === root.id) return root;
      if (sessionId === branch.id) return branch;
      throw new Error(`Unknown session ${sessionId}`);
    });

    await gateway.handleSessionIdentify(client as never, { sessionId: host.id });
    await gateway.handleSessionIdentify(client as never, { sessionId: root.id });
    client.emit.mockClear();

    createdHandler()({ session: branch });
    updatedHandler()({ session: { ...branch, title: 'Architecture: Pragmatist updated', updatedAt: 2 } });
    await flushLifecycleBroadcast();

    expect(client.emit.mock.calls.filter(([event, payload]) => (
      event === 'session:created'
      && typeof payload === 'object'
      && payload !== null
      && (payload as ChatSession).id === branch.id
    ))).toHaveLength(1);
    expect(client.emit.mock.calls.filter(([event, payload]) => (
      event === 'session:updated'
      && typeof payload === 'object'
      && payload !== null
      && (payload as ChatSession).id === branch.id
    ))).toHaveLength(1);
  });

  it('REGRESSION: stopping a parent session also stops its child subagent sessions', async () => {
    (sessions.listChildren as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'child-session' }])
      .mockResolvedValueOnce([]);

    await gateway.handleChatStop(client as never, { sessionId: 'session-1' });

    expect((pipeline.stopAndDrain as ReturnType<typeof vi.fn>)).toHaveBeenNthCalledWith(1, 'session-1');
    expect((pipeline.stopAndDrain as ReturnType<typeof vi.fn>)).toHaveBeenNthCalledWith(2, 'child-session');
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
    expect((pipeline.stopAndDrain as ReturnType<typeof vi.fn>)).toHaveBeenNthCalledWith(1, 'session-1');
    expect((pipeline.stopAndDrain as ReturnType<typeof vi.fn>)).toHaveBeenNthCalledWith(2, 'cli-child-1');
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
    expect(client.emit.mock.calls.filter(([event]) => event === 'tool:result').length).toBe(1);
    expect(client.emit.mock.calls.filter(([event]) => event === 'agent:done').length).toBe(1);
  });

  it('REGRESSION: allows subscriber-only stop on cli-agent child after child events were streamed', async () => {
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
    (pipeline.submit as ReturnType<typeof vi.fn>).mockImplementation(async (_payload, emit) => {
      emit('chat:chunk', {
        sessionId: 'cli-child-1',
        messageId: 'msg-cli-1',
        delta: 'cli child output',
        done: false,
      });
    });

    await gateway.handleChatSend(client as never, {
      sessionId: 'session-1',
      content: 'spawn cli child',
      personaId: 'default',
    });

    const socketSessions = (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions;
    expect(socketSessions.get(client.id)?.has('cli-child-1')).toBe(false);

    await gateway.handleChatStop(client as never, { sessionId: 'cli-child-1' });

    expect(cliAgentSessionRuntime.stopSession).toHaveBeenCalledWith(
      'session-1',
      'cli-child-1',
      expect.any(Function),
    );
    expect((pipeline.stopAndDrain as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('cli-child-1');
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

    it('REGRESSION: emits a rebuildable runtime snapshot for a re-identified session', async () => {
      const pending: ToolConfirmationRequest = {
        requestId: 'req-1',
        toolCallId: 'call-1',
        sessionId: 'session-2',
        toolName: 'image_generate',
        args: { filename: 'coffee-hero.png' },
        timeoutMs: 600000,
      };
      (pipeline.getSessionStatusWithRun as ReturnType<typeof vi.fn>).mockResolvedValue({
        sessionId: 'session-2',
        active: true,
        turnId: 'turn-live',
        queueLength: 2,
      });
      (toolDispatch.getPendingConfirmations as ReturnType<typeof vi.fn>).mockReturnValue([pending]);

      await gateway.handleSessionIdentify(client as never, { sessionId: 'session-2' });

      expect(client.emit).toHaveBeenCalledWith(
        'session:runtime_snapshot',
        expect.objectContaining({
          sessionId: 'session-2',
          active: true,
          turnId: 'turn-live',
          queueLength: 2,
          pendingConfirmations: [pending],
          pendingBudgetApprovals: [],
          toolActivities: [
            expect.objectContaining({
              callId: 'call-1',
              sessionId: 'session-2',
              toolName: 'image_generate',
              status: 'pending_confirmation',
            }),
          ],
          childExecutions: [],
        }),
      );
    });

    it('re-identify uses one descendant traversal for status and snapshot replay', async () => {
      (sessions.listChildren as ReturnType<typeof vi.fn>).mockImplementation(async (sessionId: string) => (
        sessionId === 'session-1' ? [{ id: 'child-session' }] : []
      ));
      (pipeline.getSessionStatusWithRun as ReturnType<typeof vi.fn>).mockImplementation(async (sessionId: string) => ({
        sessionId,
        active: sessionId === 'session-1',
        queueLength: 0,
      }));

      await gateway.handleSessionIdentify(client as never, { sessionId: 'session-1' });

      expect(sessions.listChildren).toHaveBeenCalledTimes(2);
      expect(pipeline.getSessionStatusWithRun).toHaveBeenCalledTimes(2);
    });

    it('REGRESSION: re-identifying the root session replays descendant session metadata for hydration', async () => {
      const childSession = {
        id: 'child-session',
        personaId: 'default',
        title: 'Router',
        kind: 'subagent',
        parentSessionId: 'session-1',
        createdAt: 10,
        updatedAt: 11,
      };
      const grandchildSession = {
        id: 'grandchild-session',
        personaId: 'default',
        title: 'Analyst',
        kind: 'subagent',
        parentSessionId: 'child-session',
        createdAt: 12,
        updatedAt: 13,
      };
      (sessions.listChildren as ReturnType<typeof vi.fn>).mockImplementation(async (sessionId: string) => {
        if (sessionId === 'session-1') {
          return [childSession];
        }
        if (sessionId === 'child-session') {
          return [grandchildSession];
        }
        return [];
      });

      await gateway.handleSessionIdentify(client as never, { sessionId: 'session-1' });

      expect(client.emit.mock.calls).toContainEqual(['session:updated', childSession]);
      expect(client.emit.mock.calls).toContainEqual(['session:updated', grandchildSession]);
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
      (sessions.listChildren as ReturnType<typeof vi.fn>).mockImplementation(async (sessionId: string) => (
        sessionId === 'session-1' ? [{ id: 'child-session' }] : []
      ));
      (toolDispatch.getPendingConfirmations as ReturnType<typeof vi.fn>).mockImplementation((sessionId: string) => {
        if (sessionId === 'child-session') {
          return [pending];
        }
        return [];
      });

      await gateway.handleSessionIdentify(client as never, { sessionId: 'session-1' });

      expect(client.emit.mock.calls).toContainEqual(['tool:confirmation_required', pending]);

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

  describe('budget approvals', () => {
    it('replays invalidation to the approving socket for synthetic seeded approvals', () => {
      vi.mocked(agentBudgetApprovals.getPendingApprovals).mockReturnValue([
        {
          requestId: 'budget-1',
          sessionId: 'session-1',
          scope: 'chat',
          usedIterations: 60,
          currentLimit: 60,
          suggestedNextLimit: 70,
          requestedBy: 'chat-agent',
        },
      ]);
      vi.mocked(agentBudgetApprovals.isSyntheticPendingApproval).mockReturnValue(true);

      gateway.handleAgentBudgetApprove(client as never, {
        requestId: 'budget-1',
        sessionId: 'session-1',
        decision: 'allow_ten',
      });

      expect(agentBudgetApprovals.resolveApproval).toHaveBeenCalledWith('budget-1', 'session-1', 'allow_ten');
      expect(client.emit).toHaveBeenCalledWith('agent:budget_invalidated', {
        requestId: 'budget-1',
        sessionId: 'session-1',
        agentRun: undefined,
        reason: 'approved',
        decision: 'allow_ten',
        approvedLimit: 70,
      });
    });
  });
});
