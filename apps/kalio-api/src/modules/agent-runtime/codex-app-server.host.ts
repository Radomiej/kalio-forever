import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { nanoid } from 'nanoid';

interface JsonRpcMessage {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface CodexServerRequest {
  id: string | number;
  method: string;
  params: unknown;
}

export interface CodexServerNotification {
  method: string;
  params: unknown;
}

export type CodexAppServerConnectionCloseReason = 'exit' | 'error' | 'closed';

export interface CodexAppServerConnectionClosedEvent {
  reason: CodexAppServerConnectionCloseReason;
}

export type CodexAppServerLifecycleEvent = {
  authProfileId: string;
  processEpoch: string;
  reason: CodexAppServerConnectionCloseReason | 'reset';
};

export interface CodexAppServerConnection {
  readonly processEpoch: string;
  isClosed?(): boolean;
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  respond(id: string | number, result: unknown): void;
  onRequest(listener: (request: CodexServerRequest) => void | Promise<void>): () => void;
  onNotification(listener: (notification: CodexServerNotification) => void): () => void;
  onClosed?(listener: (event: CodexAppServerConnectionClosedEvent) => void): () => void;
  close(): Promise<void>;
}

export type CodexAppServerConnectionStatus = 'offline' | 'starting' | 'online' | 'error';

export interface CodexAppServerHostStatus {
  authProfileId: string;
  status: CodexAppServerConnectionStatus;
  connected: boolean;
  openSessionCount: number;
  processEpoch?: string;
  lastError?: string;
}

export function buildCodexSpawnSpec(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec: string = process.env.ComSpec ?? 'cmd.exe',
): { command: string; args: string[] } {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) {
    return { command, args };
  }

  return {
    command: comSpec,
    args: ['/d', '/s', '/c', command, ...args],
  };
}

/**
 * Keep Codex's user-configured MCP servers outside the Kalio tool boundary by
 * default. An explicit environment opt-in is required to inherit them.
 */
export function buildCodexAppServerArgs(
  disabledFeatures: string[] = ['multi_agent'],
  inheritConfiguredMcp = process.env['KALIO_CODEX_INHERIT_MCP']?.trim().toLowerCase() === 'true',
): string[] {
  return [
    'app-server',
    '--stdio',
    ...(inheritConfiguredMcp ? [] : ['-c', 'mcp_servers={}']),
    ...disabledFeatures.flatMap((feature) => ['--disable', feature]),
  ];
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Small JSON-RPC router shared by the real stdio connection and protocol tests.
 * App Server uses newline-delimited JSON; no shell/process tool is used here.
 */
export class CodexAppServerProtocolRouter {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestListeners = new Set<(request: CodexServerRequest) => void | Promise<void>>();
  private readonly notificationListeners = new Set<(notification: CodexServerNotification) => void>();

  registerPending(id: string, pending: PendingRequest): void {
    this.pending.set(id, pending);
  }

  removePending(id: string): void {
    this.pending.delete(id);
  }

  onRequest(listener: (request: CodexServerRequest) => void | Promise<void>): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onNotification(listener: (notification: CodexServerNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  handle(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.method) {
      const request: CodexServerRequest = {
        id: message.id,
        method: message.method,
        params: message.params,
      };
      for (const listener of this.requestListeners) {
        void listener(request);
      }
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      if (message.error) {
        pending.reject(new Error(message.error.message ?? `Codex App Server error ${message.error.code ?? 'unknown'}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      const notification = { method: message.method, params: message.params };
      for (const listener of this.notificationListeners) listener(notification);
    }
  }

  rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

class StdioCodexAppServerConnection implements CodexAppServerConnection {
  readonly processEpoch = nanoid();
  private readonly router = new CodexAppServerProtocolRouter();
  private readonly closeListeners = new Set<(event: CodexAppServerConnectionClosedEvent) => void>();
  private nextRequestId = 1;
  private closed = false;
  private closeNotified = false;

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly logger: Logger,
  ) {
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) logger.debug(`Codex App Server stderr: ${text}`);
    });
    child.once('exit', (code, signal) => {
      this.closed = true;
      this.router.rejectAll(new Error(`Codex App Server exited (${code ?? 'null'}/${signal ?? 'none'}).`));
      this.notifyClosed({ reason: 'exit' });
    });
    child.once('error', (error) => {
      this.closed = true;
      this.router.rejectAll(error);
      this.notifyClosed({ reason: 'error' });
    });
  }

  static async start(logger: Logger, options: { command?: string; disabledFeatures?: string[]; env?: NodeJS.ProcessEnv } = {}): Promise<StdioCodexAppServerConnection> {
    const command = options.command ?? (process.platform === 'win32' ? 'codex.cmd' : 'codex');
    const args = buildCodexAppServerArgs(options.disabledFeatures);
    const spawnSpec = buildCodexSpawnSpec(command, args);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });
    const connection = new StdioCodexAppServerConnection(child, logger);
    await connection.request('initialize', {
      clientInfo: { name: 'kalio', title: 'Kalio', version: '0.1.0' },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: ['rawResponse/completed', 'rawResponseItem/completed'],
      },
    });
    connection.notify('initialized');
    return connection;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Codex App Server connection is closed.'));
    const id = String(this.nextRequestId++);
    const message = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.router.registerPending(id, { resolve, reject });
      try {
        this.child.stdin.write(`${message}\n`);
      } catch (error) {
        this.router.removePending(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.child.stdin.write(`${JSON.stringify({ method, ...(params === undefined ? {} : { params }) })}\n`);
  }

  respond(id: string | number, result: unknown): void {
    if (this.closed) return;
    this.child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  onRequest(listener: (request: CodexServerRequest) => void | Promise<void>): () => void {
    return this.router.onRequest(listener);
  }

  onNotification(listener: (notification: CodexServerNotification) => void): () => void {
    return this.router.onNotification(listener);
  }

  onClosed(listener: (event: CodexAppServerConnectionClosedEvent) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.router.rejectAll(new Error('Codex App Server connection closed.'));
    this.notifyClosed({ reason: 'closed' });
    this.child.kill();
  }

  isClosed(): boolean {
    return this.closed;
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      this.router.handle(JSON.parse(trimmed) as JsonRpcMessage);
    } catch (error) {
      this.logger.warn(`Ignoring malformed Codex App Server message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private notifyClosed(event: CodexAppServerConnectionClosedEvent): void {
    if (this.closeNotified) return;
    this.closeNotified = true;
    for (const listener of this.closeListeners) listener(event);
  }
}

@Injectable()
export class CodexAppServerHost implements OnModuleDestroy {
  private readonly logger = new Logger(CodexAppServerHost.name);
  private readonly connections = new Map<string, Promise<CodexAppServerConnection>>();
  private readonly resolvedConnections = new Map<string, CodexAppServerConnection>();
  private readonly connectionStates = new Map<string, { status: CodexAppServerConnectionStatus; lastError?: string }>();
  private readonly threadIds = new Map<string, Set<string>>();
  private readonly lifecycleListeners = new Set<(event: CodexAppServerLifecycleEvent) => void>();
  private readonly connectionCloseUnsubs = new Map<string, () => void>();
  private readonly notifiedProcessEpochs = new Set<string>();

  onConnectionLost(listener: (event: CodexAppServerLifecycleEvent) => void): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  getStatus(authProfileId: string): CodexAppServerHostStatus {
    const connection = this.resolvedConnections.get(authProfileId);
    const state = this.connectionStates.get(authProfileId) ?? { status: 'offline' as const };
    const closed = connection?.isClosed?.() ?? false;
    const status = closed ? 'error' : state.status;
    return {
      authProfileId,
      status,
      connected: status === 'online' && !closed,
      openSessionCount: this.threadIds.get(authProfileId)?.size ?? 0,
      ...(connection && !closed ? { processEpoch: connection.processEpoch } : {}),
      ...(state.lastError ? { lastError: state.lastError } : closed ? { lastError: 'Codex App Server process is closed.' } : {}),
    };
  }

  registerThread(authProfileId: string, threadId: string): void {
    const threads = this.threadIds.get(authProfileId) ?? new Set<string>();
    threads.add(threadId);
    this.threadIds.set(authProfileId, threads);
  }

  async reset(authProfileId: string): Promise<void> {
    const currentConnection = this.resolvedConnections.get(authProfileId);
    if (currentConnection) {
      this.notifyConnectionLost(authProfileId, currentConnection, 'reset');
    }
    this.detachConnection(authProfileId);
    const connectionPromise = this.connections.get(authProfileId);
    this.connections.delete(authProfileId);
    this.resolvedConnections.delete(authProfileId);
    this.threadIds.delete(authProfileId);
    this.connectionStates.set(authProfileId, { status: 'offline' });
    if (!connectionPromise) return;

    try {
      const connection = await connectionPromise;
      if (!currentConnection) {
        this.notifyConnectionLost(authProfileId, connection, 'reset');
      }
      await connection.close();
    } catch (error) {
      this.logger.warn(`Codex App Server reset failed for ${authProfileId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getConnection(authProfileId: string, permissionProfile: string): Promise<CodexAppServerConnection> {
    // Sandbox/approval settings are scoped to a Codex thread or turn. Keep one
    // long-lived App Server per auth/trust profile instead of one process per mode.
    void permissionProfile;
    const key = authProfileId;
    const existing = this.connections.get(key);
    if (existing) {
      const connection = await existing;
      if (!connection.isClosed?.()) return connection;
      this.detachConnection(key);
      this.connections.delete(key);
      this.resolvedConnections.delete(key);
    }
    this.connectionStates.set(key, { status: 'starting' });
    const connection = StdioCodexAppServerConnection.start(this.logger, {
      env: codexAuthEnvironment(authProfileId),
    });
    this.connections.set(key, connection);
    try {
      const resolved = await connection;
      this.resolvedConnections.set(key, resolved);
      this.attachConnection(key, resolved);
      this.connectionStates.set(key, { status: 'online' });
      return resolved;
    } catch (error) {
      this.detachConnection(key);
      this.connections.delete(key);
      this.resolvedConnections.delete(key);
      this.connectionStates.set(key, {
        status: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async login(authProfileId: string, loginType: 'chatgpt' | 'chatgptDeviceCode' = 'chatgptDeviceCode'): Promise<unknown> {
    const connection = await this.getConnection(authProfileId, 'login');
    return connection.request('account/login/start', { type: loginType });
  }

  async close(): Promise<void> {
    for (const [authProfileId, connection] of this.resolvedConnections) {
      this.notifyConnectionLost(authProfileId, connection, 'closed');
    }
    for (const unsubscribe of this.connectionCloseUnsubs.values()) unsubscribe();
    this.connectionCloseUnsubs.clear();
    const connections = [...this.connections.values()];
    this.connections.clear();
    this.resolvedConnections.clear();
    this.threadIds.clear();
    this.connectionStates.clear();
    await Promise.all((await Promise.all(connections)).map((connection) => connection.close()));
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private attachConnection(authProfileId: string, connection: CodexAppServerConnection): void {
    this.detachConnection(authProfileId);
    const unsubscribe = connection.onClosed?.(({ reason }) => {
      this.notifyConnectionLost(authProfileId, connection, reason);
    });
    if (unsubscribe) this.connectionCloseUnsubs.set(authProfileId, unsubscribe);
  }

  private detachConnection(authProfileId: string): void {
    this.connectionCloseUnsubs.get(authProfileId)?.();
    this.connectionCloseUnsubs.delete(authProfileId);
  }

  private notifyConnectionLost(
    authProfileId: string,
    connection: CodexAppServerConnection,
    reason: CodexAppServerLifecycleEvent['reason'],
  ): void {
    if (this.notifiedProcessEpochs.has(connection.processEpoch)) return;
    this.notifiedProcessEpochs.add(connection.processEpoch);
    this.threadIds.delete(authProfileId);
    this.connectionStates.set(authProfileId, reason === 'reset' || reason === 'closed'
      ? { status: 'offline' }
      : { status: 'error', lastError: `Codex App Server connection ${reason}.` });
    const event: CodexAppServerLifecycleEvent = {
      authProfileId,
      processEpoch: connection.processEpoch,
      reason,
    };
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn(`Codex App Server lifecycle listener failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

function codexAuthEnvironment(authProfileId: string): NodeJS.ProcessEnv | undefined {
  if (authProfileId === 'chatgpt-default') return undefined;
  const root = process.env['KALIO_CODEX_HOME_ROOT']?.trim()
    || resolve(homedir(), '.kalio', 'codex-auth');
  const safeProfileId = authProfileId.replace(/[^A-Za-z0-9_-]/g, '_');
  return { CODEX_HOME: resolve(root, safeProfileId) };
}
