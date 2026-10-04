import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Transform, Writable } from 'node:stream';
import { isAbsolute } from 'node:path';
import { nanoid } from 'nanoid';
import { createDevinCliConfig, type DevinCliConfigHandle } from './devin-cli-config';
import { suppressInheritedDevinMcp } from './devin-cli-mcp-catalog';
import { stopDevinChild } from './devin-cli-process-shutdown';
import { resolveDevinCliPath } from './devin-cli-model-catalog.service';
import { DEFAULT_DEVIN_NATIVE_TOOLS_POLICY, DEVIN_NATIVE_TOOL_CATEGORIES, type DevinNativeToolsPolicy } from './devin-native-tools';
import { DevinCliProbeService, type DevinCliProbeStatus } from './devin-cli-probe.service';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type ClientConnection,
  type McpServer,
  type RequestPermissionRequest,
  type SessionNotification,
  type StopReason,
  type ToolCallContent,
} from '@agentclientprotocol/sdk';

const MAX_NDJSON_LINE_BYTES = 1024 * 1024;

export { parseDevinCliProbe } from './devin-cli-probe.service';
export type { DevinCliProbe, DevinCliProbeCommand, DevinCliProbeOutput } from './devin-cli-probe.service';

export interface DevinCliLaunchSpec {
  command: string;
  args: string[];
}

export interface DevinCliIntegrationStatus extends DevinCliProbeStatus {
  hostCount: number;
  hosts: Array<{ model: string; status: 'starting' | 'online' | 'error' | 'offline'; processEpoch?: string }>;
}

export interface DevinAcpSession {
  sessionId: string;
  cwd: string;
  processEpoch: string;
  resumed: boolean;
}

export interface DevinAcpPromptInput {
  signal?: AbortSignal;
  onTurnStart?: () => (() => void) | void;
  onText: (text: string) => void;
  onThought: (text: string) => void;
  onToolActivity?: (activity: DevinAcpToolActivity) => void;
  onPermission: (request: RequestPermissionRequest) => Promise<'accept' | 'decline' | 'cancel'>;
}

export interface DevinAcpToolActivity {
  toolCallId: string;
  kind?: string | null;
  name?: string | null;
  title?: string | null;
  status?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolCallContent[] | null;
}

interface SessionState {
  cwd: string;
  processEpoch: string;
  mcpServers: McpServer[];
  tail: Promise<void>;
  active?: ActiveTurn;
}

interface DevinSessionWorkspace {
  cwd: string;
  additionalDirectories?: string[];
}

interface ActiveTurn extends DevinAcpPromptInput {
  rejectConnection: (error: Error) => void;
}

export function buildDevinCliLaunchSpec(model: string, executable = resolveDevinCliPath()): DevinCliLaunchSpec {
  const normalizedModel = model.trim();
  if (!normalizedModel) throw new Error('Devin CLI model is required.');
  return { command: executable, args: ['--model', normalizedModel, 'acp'] };
}

export class DevinAcpHost {
  private readonly logger = new Logger(DevinAcpHost.name);
  private readonly sessions = new Map<string, SessionState>();
  private connection?: ClientConnection;
  private child?: ChildProcessWithoutNullStreams;
  private processEpoch?: string;
  private capabilities: AgentCapabilities = {};
  private status: 'starting' | 'online' | 'error' | 'offline' = 'offline';
  private starting?: Promise<void>;
  private config?: DevinCliConfigHandle;
  private closing = false;
  private closePromise?: Promise<void>;

  constructor(readonly model: string, readonly nativePolicy: DevinNativeToolsPolicy = { ...DEFAULT_DEVIN_NATIVE_TOOLS_POLICY }) {}

  getStatus(): { model: string; status: DevinAcpIntegrationStatus; processEpoch?: string } {
    return {
      model: this.model,
      status: this.status,
      ...(this.processEpoch ? { processEpoch: this.processEpoch } : {}),
    };
  }

  async ensureSession(cwd: string, externalThreadId?: string, mcpServers: McpServer[] = []): Promise<DevinAcpSession> {
    const normalizedCwd = normalizeCwd(cwd);
    const normalizedMcpServers = [...mcpServers];
    const connection = await this.ensureConnection(normalizedMcpServers);
    const sessionWorkspace = this.buildSessionWorkspace(normalizedCwd);
    if (externalThreadId) {
      const existing = this.sessions.get(externalThreadId);
      if (existing) {
        if (existing.cwd !== normalizedCwd) throw new Error('Devin ACP session cannot change its working directory.');
        if (JSON.stringify(existing.mcpServers) !== JSON.stringify(normalizedMcpServers)) {
          throw new Error('Devin ACP session tool policy changed; reset the Devin host before continuing.');
        }
        if (existing.processEpoch === this.processEpoch) {
          return { sessionId: externalThreadId, cwd: normalizedCwd, processEpoch: existing.processEpoch, resumed: false };
        }
      }
      await this.restoreSession(connection, externalThreadId, sessionWorkspace, normalizedMcpServers);
      const restoredEpoch = this.requireProcessEpoch();
      const state: SessionState = { cwd: normalizedCwd, processEpoch: restoredEpoch, mcpServers: normalizedMcpServers, tail: Promise.resolve() };
      this.sessions.set(externalThreadId, state);
      return { sessionId: externalThreadId, cwd: normalizedCwd, processEpoch: restoredEpoch, resumed: true };
    }

    const response = await connection.agent.request(methods.agent.session.new, {
      ...sessionWorkspace,
      mcpServers: normalizedMcpServers,
    });
    const sessionId = response.sessionId?.trim();
    if (!sessionId) throw new Error('Devin ACP did not return a session id.');
    const processEpoch = this.requireProcessEpoch();
    this.sessions.set(sessionId, { cwd: normalizedCwd, processEpoch, mcpServers: normalizedMcpServers, tail: Promise.resolve() });
    return { sessionId, cwd: normalizedCwd, processEpoch, resumed: false };
  }

  async supportsHttpMcp(): Promise<boolean> {
    await this.ensureConnection();
    return this.capabilities.mcpCapabilities?.http === true;
  }

  async prompt(sessionId: string, prompt: string, input: DevinAcpPromptInput): Promise<StopReason> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Devin ACP session is not registered: ${sessionId}`);
    const run = session.tail.then(() => this.promptNow(sessionId, prompt, input), () => this.promptNow(sessionId, prompt, input));
    session.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closePromise = this.closeNow().finally(() => { this.closePromise = undefined; });
    }
    return this.closePromise;
  }

  private async closeNow(): Promise<void> {
    this.closing = true;
    this.status = 'offline';
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      await stopDevinChild(child);
    }
    this.connection?.close();
    if (this.starting) {
      try {
        await this.starting;
      } catch (error) {
        this.logger.debug(`Devin ACP startup stopped during shutdown: ${asError(error, 'Startup interrupted.').message}`);
      }
    }
    this.status = 'offline';
    this.connection = undefined;
    this.child = undefined;
    this.starting = undefined;
    this.sessions.clear();
    const config = this.config;
    await config?.cleanup();
    this.config = undefined;
  }

  private async ensureConnection(mcpServers: readonly McpServer[] = []): Promise<ClientConnection> {
    if (this.closing) throw new Error('Devin ACP host is closing; acquire a new host after reset.');
    if (this.starting) {
      await this.starting;
      return this.requireConnection();
    }
    if (this.connection && !this.connection.signal.aborted) return this.connection;
    this.closing = false;
    this.status = 'starting';
    this.starting = this.startConnection(mcpServers);
    try {
      await this.starting;
      return this.requireConnection();
    } finally {
      this.starting = undefined;
    }
  }

  private async startConnection(mcpServers: readonly McpServer[]): Promise<void> {
    const spec = buildDevinCliLaunchSpec(this.model, resolveDevinCliPath());
    const config = await createDevinCliConfig(this.model, mcpServers, this.nativePolicy);
    this.config = config;
    try {
      const suppressedCount = await suppressInheritedDevinMcp(spec.command, config, mcpServers.map(server => server.name));
      this.logger.debug(`Devin ACP private MCP overlay verified (${suppressedCount} inherited entries suppressed).`);
    } catch (error) {
      this.status = 'error';
      await config.cleanup();
      this.config = undefined;
      throw error;
    }
    if (this.closing) {
      throw new Error('Devin ACP host was closed during startup.');
    }
    // Devin 3000.3+ loads project MCP servers from the dedicated
    // `.devin/mcp_config.local.json`; passing the legacy `--config` file
    // bypasses that loader, so keep the ephemeral project overlay discoverable
    // from the child cwd and select only the model on the command line.
    const child = spawn(spec.command, spec.args, {
      env: { ...process.env },
      ...(config ? { cwd: config.cwd } : {}),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const guardedStdout = child.stdout.pipe(createNdjsonFrameGuard());
    const app = client({ name: 'kalio' })
      .onRequest(methods.client.session.requestPermission, ({ params }) => this.handlePermission(params))
      .onNotification(methods.client.session.update, ({ params }) => this.handleSessionUpdate(params));
    const connection = app.connect(ndJsonStream(
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(guardedStdout) as unknown as ReadableStream<Uint8Array>,
    ));
    this.child = child;
    this.connection = connection;
    this.processEpoch = nanoid();
    const processEpoch = this.processEpoch;
    this.status = 'starting';
    child.once('error', (error) => this.handleConnectionClosed(processEpoch, 'error', error));
    child.once('exit', (code, signal) => this.handleConnectionClosed(processEpoch, 'exit', new Error(`Devin ACP exited (${code ?? 'null'}/${signal ?? 'none'}).`)));
    void connection.closed.then(() => this.handleConnectionClosed(processEpoch, 'closed', new Error('Devin ACP connection closed.')));
    try {
      const response = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: 'kalio', title: 'Kalio', version: '0.1.0' },
      });
      this.capabilities = response.agentCapabilities ?? {};
      this.status = 'online';
    } catch (error) {
      this.status = 'error';
      connection.close(error);
      child.kill();
      throw asError(error, 'Devin ACP initialization failed.');
    }
  }

  private buildSessionWorkspace(cwd: string): DevinSessionWorkspace {
    const configCwd = this.config?.cwd;
    if (!configCwd) return { cwd };
    return this.capabilities.sessionCapabilities?.additionalDirectories !== undefined
      ? { cwd: configCwd, additionalDirectories: [cwd] }
      : { cwd: configCwd };
  }

  private async restoreSession(connection: ClientConnection, sessionId: string, workspace: DevinSessionWorkspace, mcpServers: McpServer[]): Promise<void> {
    // Kalio already owns durable history; reattach without provider history replay.
    if (this.capabilities.sessionCapabilities?.resume) {
      try {
        await connection.agent.request(methods.agent.session.resume, { sessionId, ...workspace, mcpServers });
        return;
      } catch (error) {
        throw asError(error, `Devin ACP could not resume persisted session ${sessionId}.`);
      }
    }
    // TODO: legacy fallback — load-only ACP agents cannot reattach without replay.
    if (this.capabilities.loadSession === true) {
      try {
        await connection.agent.request(methods.agent.session.load, { sessionId, ...workspace, mcpServers });
        return;
      } catch (error) {
        throw asError(error, `Devin ACP could not load persisted session ${sessionId}.`);
      }
    }
    throw new Error('Devin ACP host restarted but the agent does not advertise session/load or session/resume.');
  }

  private async promptNow(sessionId: string, prompt: string, input: DevinAcpPromptInput): Promise<StopReason> {
    const connection = await this.ensureConnection();
    const session = this.sessions.get(sessionId);
    if (!session || session.processEpoch !== this.processEpoch) throw new Error(`Devin ACP session ${sessionId} is not active on this host.`);
    if (input.signal?.aborted) return 'cancelled';
    let rejectConnection!: (error: Error) => void;
    const connectionFailure = new Promise<never>((_, reject) => { rejectConnection = reject; });
    const active: ActiveTurn = { ...input, rejectConnection };
    session.active = active;
    const releaseTurn = input.onTurnStart?.() ?? (() => undefined);
    const abortHandler = (): void => {
      void connection.agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => undefined);
    };
    input.signal?.addEventListener('abort', abortHandler, { once: true });
    try {
      const promptRequest = connection.agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text: prompt }],
      }, input.signal ? { cancellationSignal: input.signal } : undefined);
      const response = await Promise.race([promptRequest, connectionFailure]);
      return response.stopReason;
    } catch (error) {
      if (input.signal?.aborted) return 'cancelled';
      throw asError(error, 'Devin ACP prompt failed.');
    } finally {
      releaseTurn();
      input.signal?.removeEventListener('abort', abortHandler);
      if (session.active === active) session.active = undefined;
    }
  }

  private async handlePermission(params: RequestPermissionRequest): Promise<{ outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string } }> {
    const session = this.sessions.get(params.sessionId);
    if (!session?.active) return { outcome: { outcome: 'cancelled' } };
    const decision = await session.active.onPermission(params);
    if (decision === 'cancel') return { outcome: { outcome: 'cancelled' } };
    const preferredKind = decision === 'accept' ? 'allow_once' : 'reject_once';
    const option = params.options.find((candidate) => candidate.kind === preferredKind)
      ?? params.options.find((candidate) => decision === 'accept' ? candidate.kind.startsWith('allow') : candidate.kind.startsWith('reject'));
    return option
      ? { outcome: { outcome: 'selected', optionId: option.optionId } }
      : { outcome: { outcome: 'cancelled' } };
  }

  private handleSessionUpdate(params: SessionNotification): void {
    const active = this.sessions.get(params.sessionId)?.active;
    if (!active) return;
    const update = params.update;
    if ((update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk') && update.content.type === 'text') {
      if (update.sessionUpdate === 'agent_message_chunk') active.onText(update.content.text);
      else active.onThought(update.content.text);
      return;
    }
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      active.onToolActivity?.({
        toolCallId: update.toolCallId,
        kind: update.kind,
        name: update.name,
        title: update.title,
        status: update.status,
        rawInput: update.rawInput,
        rawOutput: update.rawOutput,
        content: update.content,
      });
    }
  }

  private handleConnectionClosed(processEpoch: string, reason: 'exit' | 'error' | 'closed', error: Error): void {
    if (processEpoch !== this.processEpoch || this.closing || this.status === 'offline') return;
    this.status = 'error';
    this.connection = undefined;
    this.child = undefined;
    for (const session of this.sessions.values()) session.active?.rejectConnection(error);
    this.logger.warn(`Devin ACP host ${this.model} lost its process (${reason}).`);
  }

  private requireConnection(): ClientConnection {
    if (!this.connection || this.connection.signal.aborted) throw new Error(`Devin ACP host ${this.model} is not connected.`);
    return this.connection;
  }

  private requireProcessEpoch(): string {
    if (!this.processEpoch) throw new Error('Devin ACP process epoch is unavailable.');
    return this.processEpoch;
  }
}

@Injectable()
export class DevinAcpHostRegistry implements OnModuleDestroy {
  private readonly hosts = new Map<string, DevinAcpHost>();
  private resetPromise?: Promise<void>;

  constructor(private readonly probes: DevinCliProbeService) {}

  async get(model: string, scopeKey?: string, nativePolicy: DevinNativeToolsPolicy = DEFAULT_DEVIN_NATIVE_TOOLS_POLICY): Promise<DevinAcpHost> {
    if (this.resetPromise) await this.resetPromise;
    const normalizedModel = model.trim();
    if (!normalizedModel) throw new Error('Devin CLI model is required.');
    const key = scopeKey?.trim() ? `${normalizedModel}\u0000${scopeKey.trim()}` : normalizedModel;
    const existing = this.hosts.get(key);
    if (existing) {
      if (DEVIN_NATIVE_TOOL_CATEGORIES.some(category => existing.nativePolicy[category] !== nativePolicy[category])) {
        throw new Error('Devin native tool policy changed; reset the Devin host before continuing.');
      }
      return existing;
    }
    const host = new DevinAcpHost(normalizedModel, Object.freeze({ ...nativePolicy }));
    this.hosts.set(key, host);
    return host;
  }

  reset(): Promise<void> {
    if (!this.resetPromise) {
      this.resetPromise = this.resetNow().finally(() => { this.resetPromise = undefined; });
    }
    return this.resetPromise;
  }

  private async resetNow(): Promise<void> {
    const results = await Promise.allSettled([...this.hosts.entries()].map(async ([key, host]) => {
      await host.close();
      if (this.hosts.get(key) === host) this.hosts.delete(key);
    }));
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map((result) => result.reason), 'Devin ACP reset failed.');
  }

  async getStatus(refresh = false): Promise<DevinCliIntegrationStatus> {
    const probe = await this.probes.getStatus(refresh);
    return {
      ...probe,
      hostCount: this.hosts.size,
      hosts: [...this.hosts.values()].map((host) => host.getStatus()),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.hosts.values()].map((host) => host.close()));
  }
}

function normalizeCwd(cwd: string): string {
  const value = cwd.trim();
  if (!value || !isAbsolute(value)) throw new Error('Devin ACP requires an absolute working directory.');
  return value;
}


function createNdjsonFrameGuard(): Transform {
  let lineBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback): void {
      for (const byte of chunk) {
        lineBytes = byte === 10 ? 0 : lineBytes + 1;
        if (lineBytes > MAX_NDJSON_LINE_BYTES) {
          callback(new Error('Devin ACP frame exceeded the maximum size.'));
          return;
        }
      }
      callback(null, chunk);
    },
  });
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

type DevinAcpIntegrationStatus = 'starting' | 'online' | 'error' | 'offline';
