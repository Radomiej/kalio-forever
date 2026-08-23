import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { DevinCliModel } from '@kalio/types';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable, Transform, Writable } from 'node:stream';
import { isAbsolute } from 'node:path';
import { nanoid } from 'nanoid';
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
} from '@agentclientprotocol/sdk';

export const DEVIN_CLI_MODELS = ['glm-5-2', 'swe-1-7'] as const satisfies readonly DevinCliModel[];
const MAX_NDJSON_LINE_BYTES = 1024 * 1024;
const PROBE_TIMEOUT_MS = 10_000;

export interface DevinCliLaunchSpec {
  command: string;
  args: string[];
}

export interface DevinCliProbeCommand {
  text: string;
  exitCode: number;
}

export interface DevinCliProbeOutput {
  version: DevinCliProbeCommand;
  authStatus: DevinCliProbeCommand;
  acpHelp: DevinCliProbeCommand;
  models: DevinCliProbeCommand;
}

export interface DevinCliProbe {
  executable: string;
  version: string | null;
  authenticated: boolean;
  acp: boolean;
  models: DevinCliModel[];
}

export interface DevinCliIntegrationStatus extends DevinCliProbe {
  hostCount: number;
  hosts: Array<{ model: DevinCliModel; status: 'starting' | 'online' | 'error' | 'offline'; processEpoch?: string }>;
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
}

interface SessionState {
  cwd: string;
  processEpoch: string;
  mcpServers: McpServer[];
  tail: Promise<void>;
  active?: ActiveTurn;
}

interface ActiveTurn extends DevinAcpPromptInput {
  rejectConnection: (error: Error) => void;
}

export function isDevinCliModel(value: string): value is DevinCliModel {
  return (DEVIN_CLI_MODELS as readonly string[]).includes(value);
}

export function buildDevinCliLaunchSpec(model: DevinCliModel, executable = resolveDevinCliPath()): DevinCliLaunchSpec {
  if (!isDevinCliModel(model)) throw new Error(`Unsupported Devin CLI model: ${model}`);
  return { command: executable, args: ['--model', model, 'acp'] };
}

export function resolveDevinCliPath(): string {
  return process.env['DEVIN_CLI_PATH']?.trim() || (process.platform === 'win32' ? 'devin.exe' : 'devin');
}

export function parseDevinCliProbe(executable: string, output: DevinCliProbeOutput): DevinCliProbe {
  // Text alone is not trustworthy when the CLI has crashed after writing partial output.
  const versionMatch = output.version.exitCode === 0 ? output.version.text.match(/devin\s+([^\s]+)/i) : null;
  const authenticated = output.authStatus.exitCode === 0
    && /logged\s+in|authenticated/i.test(output.authStatus.text)
    && !/not\s+logged\s+in|unauthenticated|login required/i.test(output.authStatus.text);
  const acp = output.acpHelp.exitCode === 0
    && /\bacp\b/i.test(output.acpHelp.text)
    && /usage|run|mode|agent/i.test(output.acpHelp.text);
  const models = output.models.exitCode === 0
    ? DEVIN_CLI_MODELS.filter((model) => output.models.text.toLowerCase().includes(model))
    : [];
  return {
    executable,
    version: versionMatch?.[1] ?? null,
    authenticated,
    acp,
    models,
  };
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
  private closing = false;

  constructor(readonly model: DevinCliModel) {}

  getStatus(): { model: DevinCliModel; status: DevinAcpIntegrationStatus; processEpoch?: string } {
    return {
      model: this.model,
      status: this.status,
      ...(this.processEpoch ? { processEpoch: this.processEpoch } : {}),
    };
  }

  async ensureSession(cwd: string, externalThreadId?: string, mcpServers: McpServer[] = []): Promise<DevinAcpSession> {
    const normalizedCwd = normalizeCwd(cwd);
    const normalizedMcpServers = [...mcpServers];
    const connection = await this.ensureConnection();
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
      await this.restoreSession(connection, externalThreadId, normalizedCwd, normalizedMcpServers);
      const restoredEpoch = this.requireProcessEpoch();
      const state: SessionState = { cwd: normalizedCwd, processEpoch: restoredEpoch, mcpServers: normalizedMcpServers, tail: Promise.resolve() };
      this.sessions.set(externalThreadId, state);
      return { sessionId: externalThreadId, cwd: normalizedCwd, processEpoch: restoredEpoch, resumed: true };
    }

    const response = await connection.agent.request(methods.agent.session.new, { cwd: normalizedCwd, mcpServers: normalizedMcpServers });
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

  async close(): Promise<void> {
    this.closing = true;
    this.status = 'offline';
    this.connection?.close();
    this.child?.kill();
    this.connection = undefined;
    this.child = undefined;
    this.starting = undefined;
    this.sessions.clear();
  }

  private async ensureConnection(): Promise<ClientConnection> {
    if (this.connection && !this.connection.signal.aborted) return this.connection;
    if (this.starting) {
      await this.starting;
      return this.requireConnection();
    }
    this.closing = false;
    this.status = 'starting';
    this.starting = this.startConnection();
    try {
      await this.starting;
      return this.requireConnection();
    } finally {
      this.starting = undefined;
    }
  }

  private async startConnection(): Promise<void> {
    const spec = buildDevinCliLaunchSpec(this.model);
    const child = spawn(spec.command, spec.args, {
      env: { ...process.env },
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

  private async restoreSession(connection: ClientConnection, sessionId: string, cwd: string, mcpServers: McpServer[]): Promise<void> {
    if (this.capabilities.loadSession === true) {
      try {
        await connection.agent.request(methods.agent.session.load, { sessionId, cwd, mcpServers });
        return;
      } catch (error) {
        if (!this.capabilities.sessionCapabilities?.resume) {
          throw asError(error, `Devin ACP could not load persisted session ${sessionId}.`);
        }
      }
    }
    if (this.capabilities.sessionCapabilities?.resume) {
      try {
        await connection.agent.request(methods.agent.session.resume, { sessionId, cwd, mcpServers });
        return;
      } catch (error) {
        throw asError(error, `Devin ACP could not resume persisted session ${sessionId}.`);
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
  private readonly hosts = new Map<DevinCliModel, DevinAcpHost>();

  async get(model: string): Promise<DevinAcpHost> {
    if (!isDevinCliModel(model)) throw new Error(`Unsupported Devin CLI model: ${model}.`);
    const existing = this.hosts.get(model);
    if (existing) return existing;
    const host = new DevinAcpHost(model);
    this.hosts.set(model, host);
    return host;
  }

  async reset(): Promise<void> {
    const hosts = [...this.hosts.values()];
    this.hosts.clear();
    await Promise.all(hosts.map((host) => host.close()));
  }

  async getStatus(): Promise<DevinCliIntegrationStatus> {
    const executable = resolveDevinCliPath();
    const output = await Promise.all([
      this.probeCommand(executable, ['--version']),
      this.probeCommand(executable, ['auth', 'status']),
      this.probeCommand(executable, ['acp', '--help']),
      this.probeCommand(executable, ['models', 'list']),
    ]);
    const probe = parseDevinCliProbe(executable, { version: output[0], authStatus: output[1], acpHelp: output[2], models: output[3] });
    return {
      ...probe,
      hostCount: this.hosts.size,
      hosts: [...this.hosts.values()].map((host) => host.getStatus()),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.hosts.values()].map((host) => host.close()));
  }

  private async probeCommand(executable: string, args: string[]): Promise<DevinCliProbeCommand> {
    const run = promisify(execFile);
    try {
      const result = await run(executable, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 });
      return { text: `${result.stdout}\n${result.stderr}`, exitCode: 0 };
    } catch (error) {
      const result = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
      const exitCode = typeof result.code === 'number' ? result.code : 1;
      return {
        text: `${typeof result.stdout === 'string' ? result.stdout : ''}\n${typeof result.stderr === 'string' ? result.stderr : ''}`,
        exitCode,
      };
    }
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
