import { describe, expect, it, vi } from 'vitest';
import type { ExecutionProfile, ToolResult } from '@kalio/types';
import type { LLMSourceParams, LLMToolResultChannel } from '../chat/interfaces/llm-source.interface';
import type {
  CodexAppServerConnection,
  CodexServerNotification,
  CodexServerRequest,
} from './codex-app-server.host';
import { CodexAppServerLLMSource } from './codex-app-server.llm-source';

class FakeConnection implements CodexAppServerConnection {
  readonly processEpoch = 'epoch-1';
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: string | number; result: unknown }> = [];
  private readonly requestListeners = new Set<(request: CodexServerRequest) => void | Promise<void>>();
  private readonly notificationListeners = new Set<(notification: CodexServerNotification) => void>();

  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'thread/resume') return { thread: { id: 'thread-1' } };
    if (method === 'turn/start') {
      queueMicrotask(() => this.emitNotification({
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'hello' },
      }));
      queueMicrotask(() => this.emitNotification({
        method: 'turn/completed',
        params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
      }));
      return { turn: { id: 'turn-1', status: 'inProgress', error: null } };
    }
    throw new Error(`Unexpected request ${method}`);
  }

  notify(_method: string, _params?: unknown): void {}

  respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result });
  }

  onRequest(listener: (request: CodexServerRequest) => void | Promise<void>): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onNotification(listener: (notification: CodexServerNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  async close(): Promise<void> {}

  notifyRequest(request: CodexServerRequest): void {
    for (const listener of this.requestListeners) void listener(request);
  }

  emitNotification(notification: CodexServerNotification): void {
    for (const listener of this.notificationListeners) listener(notification);
  }
}

function profile(overrides: Partial<ExecutionProfile> = {}): ExecutionProfile {
  return {
    id: 'codex-guard',
    name: 'Codex Guard',
    kind: 'codex-app-server',
    model: 'gpt-5.4',
    approvalMode: 'codex_guard',
    enabled: true,
    capabilitiesVersion: '1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function params(connection: FakeConnection, overrides: Partial<LLMSourceParams> = {}): LLMSourceParams {
  return {
    messages: [
      { role: 'system', content: 'You are Kalio.' },
      { role: 'user', content: 'Say hello.' },
    ],
    tools: [],
    sessionId: 'session-1',
    messageId: 'message-1',
    executionProfile: profile(),
    toolResultChannel: { setHandler: vi.fn() },
    ...overrides,
  };
}

describe('CodexAppServerLLMSource', () => {
  it('starts a thread, streams agent deltas, and completes the turn', async () => {
    const connection = new FakeConnection();
    const host = { getConnection: vi.fn().mockResolvedValue(connection) };
    const source = new CodexAppServerLLMSource(host as never);
    const chunks = [];

    for await (const chunk of source.stream(params(connection))) chunks.push(chunk);

    expect(connection.requests.map((request) => request.method)).toEqual(['thread/start', 'turn/start']);
    expect(chunks).toEqual([{ type: 'text_delta', delta: 'hello' }, { type: 'done' }]);
  });

  it('keeps max for GPT-5.6 and downgrades it for older Codex models', async () => {
    const olderConnection = new FakeConnection();
    const olderSource = new CodexAppServerLLMSource({ getConnection: vi.fn().mockResolvedValue(olderConnection) } as never);
    for await (const _chunk of olderSource.stream(params(olderConnection, {
      executionProfile: profile({ model: 'gpt-5.4', reasoningEffort: 'max' }),
    }))) { /* consume */ }
    expect((olderConnection.requests.find((request) => request.method === 'turn/start')?.params as Record<string, unknown>)['effort'])
      .toBe('xhigh');

    const gpt56Connection = new FakeConnection();
    const gpt56Source = new CodexAppServerLLMSource({ getConnection: vi.fn().mockResolvedValue(gpt56Connection) } as never);
    for await (const _chunk of gpt56Source.stream(params(gpt56Connection, {
      executionProfile: profile({ model: 'gpt-5.6-luna', reasoningEffort: 'max' }),
    }))) { /* consume */ }
    expect((gpt56Connection.requests.find((request) => request.method === 'turn/start')?.params as Record<string, unknown>)['effort'])
      .toBe('max');
  });

  it('matches a real turn/completed notification after turn/start resolves', async () => {
    const connection = new FakeConnection();
    vi.spyOn(connection, 'request').mockImplementation(async (method, requestParams) => {
      connection.requests.push({ method, params: requestParams });
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'turn/start') {
        await Promise.resolve();
        connection.emitNotification({
          method: 'item/agentMessage/delta',
          params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'real' },
        });
        connection.emitNotification({
          method: 'turn/completed',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
        });
        return { turn: { id: 'turn-1', status: 'inProgress', error: null } };
      }
      throw new Error(`Unexpected request ${method}`);
    });
    const source = new CodexAppServerLLMSource({ getConnection: vi.fn().mockResolvedValue(connection) } as never);

    const chunks = [];
    for await (const chunk of source.stream(params(connection))) chunks.push(chunk);

    expect(chunks).toEqual([{ type: 'text_delta', delta: 'real' }, { type: 'done' }]);
  });

  it('starts a fresh thread when a persisted Codex thread cannot be resumed', async () => {
    const connection = new FakeConnection();
    vi.spyOn(connection, 'request').mockImplementation(async (method, requestParams) => {
      connection.requests.push({ method, params: requestParams });
      if (method === 'thread/resume') throw new Error('thread not found after process restart');
      if (method === 'thread/start') return { thread: { id: 'thread-2' } };
      if (method === 'turn/start') {
        connection.emitNotification({
          method: 'item/agentMessage/delta',
          params: { threadId: 'thread-2', turnId: 'turn-2', itemId: 'item-2', delta: 'rebound' },
        });
        connection.emitNotification({
          method: 'turn/completed',
          params: { threadId: 'thread-2', turn: { id: 'turn-2', status: 'completed', error: null } },
        });
        return { turn: { id: 'turn-2', status: 'inProgress', error: null } };
      }
      throw new Error(`Unexpected request ${method}`);
    });
    const onExternalAudit = vi.fn();
    const source = new CodexAppServerLLMSource({ getConnection: vi.fn().mockResolvedValue(connection) } as never);

    const chunks = [];
    for await (const chunk of source.stream(params(connection, {
      externalThreadId: 'stale-thread',
      onExternalAudit,
    }))) chunks.push(chunk);

    expect(connection.requests.map((request) => request.method)).toEqual(['thread/resume', 'thread/start', 'turn/start']);
    expect(onExternalAudit).toHaveBeenCalledWith({
      eventName: 'codex.thread.rebound',
      status: 'started',
      data: { authProfileId: 'codex-guard', previousThreadId: 'stale-thread', reason: 'resume_failed' },
    });
    expect(chunks).toEqual([{ type: 'text_delta', delta: 'rebound' }, { type: 'done' }]);
  });

  it('routes dynamic tool calls through the runtime result channel before replying to Codex', async () => {
    const connection = new FakeConnection();
    const channelHandlers: Array<(callId: string, result: ToolResult) => Promise<void> | void> = [];
    const channel: LLMToolResultChannel = { setHandler: (handler) => channelHandlers.push(handler) };
    const originalRequest = connection.request.bind(connection);
    vi.spyOn(connection, 'request').mockImplementation(async (method, requestParams) => {
      if (method === 'turn/start') {
        connection.requests.push({ method, params: requestParams });
        queueMicrotask(() => connection.notifyRequest({
          id: 9,
          method: 'item/tool/call',
          params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', tool: 'vfs_list', arguments: { path: '.' } },
        }));
        return { turn: { id: 'turn-1', status: 'inProgress', error: null } };
      }
      const response = await originalRequest(method, requestParams);
      return response;
    });
    const source = new CodexAppServerLLMSource({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    const iterator = source.stream(params(connection, { tools: [{ name: 'vfs_list', description: 'list', parameters: {}, requiresConfirmation: false }], toolResultChannel: channel }))[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: { type: 'tool_call', callId: 'call-1', name: 'vfs_list', args: { path: '.' } } });
    expect(channelHandlers).toHaveLength(1);
    await channelHandlers[0]!('call-1', { callId: 'call-1', status: 'success', data: { entries: [] } });
    connection.emitNotification({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'done' },
    });
    connection.emitNotification({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
    });
    await iterator.return?.(undefined);
    expect(connection.responses).toEqual([{
      id: 9,
      result: { contentItems: [{ type: 'inputText', text: JSON.stringify({ entries: [] }) }], success: true },
    }]);
  });

  it('routes strict native approvals through the Kalio callback and returns the protocol decision', async () => {
    const connection = new FakeConnection();
    vi.spyOn(connection, 'request').mockImplementation(async (method, requestParams) => {
      connection.requests.push({ method, params: requestParams });
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'turn/start') {
        queueMicrotask(() => connection.notifyRequest({
          id: 17,
          method: 'item/commandExecution/requestApproval',
          params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', command: 'pnpm test' },
        }));
        queueMicrotask(() => connection.emitNotification({
          method: 'turn/completed',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
        }));
        return { turn: { id: 'turn-1', status: 'inProgress', error: null } };
      }
      throw new Error(`Unexpected request ${method}`);
    });
    const approval = vi.fn().mockResolvedValue('accept' as const);
    const source = new CodexAppServerLLMSource({ getConnection: vi.fn().mockResolvedValue(connection) } as never);

    const chunks = [];
    for await (const chunk of source.stream(params(connection, {
      executionProfile: profile({ approvalMode: 'kalio_strict' }),
      onNativeApprovalRequested: approval,
    }))) chunks.push(chunk);

    expect(approval).toHaveBeenCalledWith({
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', command: 'pnpm test' },
    });
    expect(connection.responses).toEqual([{ id: 17, result: { decision: 'accept' } }]);
    expect(chunks).toEqual([{ type: 'done' }]);
  });

});
