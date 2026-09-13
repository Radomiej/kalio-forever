import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import {
  existsSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type {
  IdeDiagnosticsRequest,
  IdeLanguageStatus,
  IdeQueryRequest,
  ProjectIdeStatus,
  SessionRuntimeContext,
} from '@kalio/types';
import { AppSettingsService } from '../../database/app-settings.service';
import { DrizzleService } from '../../database/drizzle.service';
import { projects, sessions } from '../../database/schema';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';
import { CodeIntelligenceError } from './code-intelligence.errors';
import { VsCodeBridgeBackend, type BridgeConnection } from './vscode-bridge.backend';
import { AuditService } from '../chat/audit.service';
import {
  allocatePort,
  canonicalRoot,
  clamp,
  defaultSettings,
  detectInstallation,
  detectLanguages,
  extensionDir,
  findRepresentativeFile,
  prepareBridgeArgs,
  redactSecrets,
  safeId,
  sanitizeBridgeResult,
  unwrapBridgeResult,
  waitForConnection,
  type InstallationStatus,
} from './project-ide-runtime.helpers';
import {
  acquireRuntimeLock,
  clearManagedFiles,
  inspectManagedProcess,
  readLease,
  refreshLeaseStartTime,
  terminateManagedProcess,
  writeLease,
  type ManagedVscodeLease,
} from './managed-vscode-process';
const SETTINGS_KEY = 'code_intelligence.vscode';
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RUNTIME_COUNT = 2;

interface PersistedProjectConfig {
  enabled: boolean;
  canonicalRoot?: string;
  trustAcknowledgedAt?: number;
}

interface PersistedSettings {
  version: 1;
  enabled: boolean;
  autoStart: boolean;
  projects: Record<string, PersistedProjectConfig>;
}

interface Runtime extends BridgeConnection {
  runtimeId: string;
  projectId: string;
  rootPath: string;
  child?: ChildProcess;
  lease: ManagedVscodeLease;
  languages: IdeLanguageStatus[];
  lifecycle: ProjectIdeStatus['lifecycle'];
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout>;
  connectionFile: string;
  leaseFile: string;
}

export interface ResolvedIdeScope {
  projectId: string;
  projectName: string;
  rootPath: string;
  runtimeContext?: SessionRuntimeContext;
}

@Injectable()
export class ProjectIdeRuntimeManager implements OnModuleDestroy {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly pending = new Map<string, Promise<Runtime>>();
  private readonly failures = new Map<string, { code: ProjectIdeStatus['errorCode']; message: string }>();

  constructor(
    private readonly settings: AppSettingsService,
    private readonly drizzle: DrizzleService,
    private readonly allowedPaths: AllowedPathsService,
    private readonly bridgeBackend: VsCodeBridgeBackend,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async recordDetection(): Promise<void> {
    this.emitAudit('code_intelligence.detect.completed');
  }

  async loadSettings(): Promise<PersistedSettings> {
    const raw = await this.settings.get(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return {
        version: 1,
        enabled: parsed.enabled !== false,
        autoStart: parsed.autoStart !== false,
        projects: parsed.projects && typeof parsed.projects === 'object' ? parsed.projects : {},
      };
    } catch {
      return defaultSettings();
    }
  }

  async updateSettings(patch: { enabled?: boolean; autoStart?: boolean }): Promise<PersistedSettings> {
    const current = await this.loadSettings();
    const next = { ...current, ...patch };
    await this.settings.set(SETTINGS_KEY, JSON.stringify(next));
    if (next.enabled === false) {
      await Promise.all([...this.runtimes.keys()].map((projectId) => this.stop(projectId)));
    }
    return next;
  }

  async setProjectConfig(projectId: string, enabled: boolean, acknowledgedRisk = false): Promise<ProjectIdeStatus> {
    const project = await this.getProject(projectId);
    const rootPath = canonicalRoot(project.path);
    const current = await this.loadSettings();
    if (enabled && !await this.allowedPaths.isAllowed(rootPath)) {
      throw new CodeIntelligenceError('IDE_PROJECT_TRUST_REQUIRED', 'The project root must be explicitly allowed before enabling VS Code code intelligence.');
    }
    if (enabled && !acknowledgedRisk && !current.projects[projectId]?.trustAcknowledgedAt) {
      throw new CodeIntelligenceError('IDE_PROJECT_TRUST_REQUIRED', 'Project trust acknowledgement is required before enabling VS Code intelligence.');
    }
    const nextProjects = {
      ...current.projects,
      [projectId]: {
        enabled,
        canonicalRoot: rootPath,
        ...(enabled ? { trustAcknowledgedAt: current.projects[projectId]?.trustAcknowledgedAt ?? Date.now() } : {}),
      },
    };
    await this.settings.set(SETTINGS_KEY, JSON.stringify({ ...current, projects: nextProjects }));
    if (!enabled) await this.stop(projectId);
    return this.statusForProject(projectId);
  }

  async resolveSessionScope(sessionId: string): Promise<ResolvedIdeScope> {
    const [session] = await this.drizzle.db
      .select({ projectId: sessions.projectId, runtimeContext: sessions.runtimeContext })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session?.projectId || session.projectId.startsWith('system:')) {
      throw new CodeIntelligenceError('IDE_PROJECT_REQUIRED', 'A workspace project is required for code intelligence.');
    }
    const project = await this.getProject(session.projectId);
    if (!project.path) {
      throw new CodeIntelligenceError('IDE_PROJECT_REQUIRED', 'The selected project has no host path.');
    }
    const runtimeContext = session.runtimeContext as SessionRuntimeContext | null;
    if (runtimeContext?.vfsMode === 'isolated') {
      throw new CodeIntelligenceError('IDE_SANDBOX_UNSUPPORTED', 'VS Code code intelligence is unavailable for isolated VFS sessions.');
    }
    const rootPath = canonicalRoot(project.path);
    if (!await this.allowedPaths.isAllowed(rootPath)) {
      throw new CodeIntelligenceError('IDE_PROJECT_TRUST_REQUIRED', 'The project root is not an allowed host path.');
    }
    return {
      projectId: project.id,
      projectName: project.name,
      rootPath,
      runtimeContext: runtimeContext ?? undefined,
    };
  }

  async statusForProject(projectId: string): Promise<ProjectIdeStatus> {
    const project = await this.getProject(projectId);
    const rootPath = project.path ? canonicalRoot(project.path) : undefined;
    const stored = await this.loadSettings();
    const config = stored.projects[projectId];
    const installation = await detectInstallation();
    const runtime = this.runtimes.get(projectId);
    const failure = this.failures.get(projectId);
    const base = {
      projectId,
      projectName: project.name,
      ...(rootPath ? { canonicalRoot: rootPath } : {}),
      enabled: stored.enabled && config?.enabled === true,
      trustAcknowledged: Boolean(config?.trustAcknowledgedAt && config.canonicalRoot === rootPath),
      workspaceTrusted: Boolean(runtime),
      bridgeCompatible: installation.bridgeCompatible,
      ...(installation.bridgeVersion ? { bridgeVersion: installation.bridgeVersion } : {}),
      ownership: runtime ? 'managed' as const : 'none' as const,
      languages: detectLanguages(rootPath),
      capabilities: runtime ? [...runtime.capabilities].sort() : [],
    };
    if (!base.enabled) return { ...base, lifecycle: 'disabled' };
    if (!base.trustAcknowledged) return { ...base, lifecycle: 'error', errorCode: 'IDE_PROJECT_TRUST_REQUIRED', message: 'Enable and acknowledge project trust in Integrations.' };
    if (!installation.platformSupported || !installation.codeExecutable || !installation.bridgeInstalled) return { ...base, lifecycle: 'error', errorCode: 'IDE_BRIDGE_MISSING', message: 'Install VS Code and georgiana-alba.vscode-lsp-mcp-bridge.' };
    if (!installation.bridgeCompatible) return { ...base, lifecycle: 'error', errorCode: 'IDE_BRIDGE_INCOMPATIBLE', message: 'The installed VS Code Bridge version is outside Kalio’s supported range.' };
    if (runtime) return { ...base, lifecycle: runtime.lifecycle, runtimeId: runtime.runtimeId, languages: runtime.languages };
    if (this.pending.has(projectId)) return { ...base, lifecycle: 'starting', message: 'Starting the managed VS Code workspace.' };
    if (failure) return { ...base, lifecycle: 'error', errorCode: failure.code, message: failure.message };
    return { ...base, lifecycle: 'idle_stopped' };
  }

  async statusForAllProjects(): Promise<ProjectIdeStatus[]> {
    const rows = await this.drizzle.db.select({ id: projects.id, isSystem: projects.isSystem }).from(projects);
    return Promise.all(rows.filter((row) => !row.isSystem).map((row) => this.statusForProject(row.id)));
  }

  async getInstallation(): Promise<InstallationStatus> {
    return detectInstallation();
  }

  getActiveRuntimeCount(): number {
    return this.runtimes.size;
  }

  async ensureForSession(sessionId: string): Promise<{ scope: ResolvedIdeScope; runtime: Runtime }> {
    const scope = await this.resolveSessionScope(sessionId);
    const stored = await this.loadSettings();
    const config = stored.projects[scope.projectId];
    if (!stored.enabled || config?.enabled !== true) {
      throw new CodeIntelligenceError('IDE_PROJECT_DISABLED', 'VS Code code intelligence is disabled for this project.');
    }
    if (!stored.autoStart) {
      throw new CodeIntelligenceError('IDE_PROJECT_DISABLED', 'VS Code auto-start is disabled. Run the project Test action or enable auto-start in Integrations.');
    }
    if (!config.trustAcknowledgedAt || config.canonicalRoot !== scope.rootPath) {
      throw new CodeIntelligenceError('IDE_PROJECT_TRUST_REQUIRED', 'Project trust must be acknowledged again for this workspace root.');
    }
    const runtime = await this.ensureRuntime(scope.projectId, scope.rootPath);
    return { scope, runtime };
  }

  async call(sessionId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const { scope, runtime } = await this.ensureForSession(sessionId);
    this.touch(runtime);
    const safeArgs = prepareBridgeArgs(scope.rootPath, args);
    const result = await runtime.client.callTool({ name: toolName, arguments: safeArgs });
    return sanitizeBridgeResult(unwrapBridgeResult(result), scope.rootPath);
  }

  async query(sessionId: string, request: IdeQueryRequest): Promise<unknown> {
    const args = request.target ?? {};
    if (request.operation === 'workspace_symbols') {
      if (!request.query?.trim()) throw new CodeIntelligenceError('IDE_QUERY_INVALID', 'workspace_symbols requires query.');
      return this.call(sessionId, 'workspace_symbols', { query: request.query, maxResults: clamp(request.maxResults, 30, 100), ...(args.kind ? { kind: args.kind } : {}) });
    }
    if (request.operation === 'document_symbols') {
      if (!args.path) throw new CodeIntelligenceError('IDE_QUERY_INVALID', 'document_symbols requires target.path.');
      return this.call(sessionId, 'document_symbols', { file: args.path, maxResults: clamp(request.maxResults, 30, 100) });
    }
    if (['incoming_calls', 'outgoing_calls'].includes(request.operation) && !args.symbol) {
      throw new CodeIntelligenceError('IDE_QUERY_INVALID', `${request.operation} requires target.symbol.`);
    }
    if (['definition', 'references', 'incoming_calls', 'outgoing_calls'].includes(request.operation) && args.symbol) {
      const bridgeTool = ({
        definition: 'find_definition_for_symbol', references: 'find_references_for_symbol',
        incoming_calls: 'find_callers_for_symbol', outgoing_calls: 'find_callees_for_symbol',
      } as Record<string, string>)[request.operation];
      return this.call(sessionId, bridgeTool, {
        query: args.symbol,
        ...(args.kind ? { kind: args.kind } : {}),
        ...(args.container ? { containerName: args.container } : {}),
        ...(args.path ? { file: args.path } : {}),
        maxResults: clamp(request.maxResults, 30, 100),
      });
    }
    const bridgeTool = ({
      definition: 'go_to_definition', declaration: 'go_to_declaration', type_definition: 'go_to_type_definition',
      implementation: 'go_to_implementation', references: 'find_references', hover: 'hover',
    } as Record<string, string>)[request.operation];
    if (!bridgeTool) throw new CodeIntelligenceError('IDE_QUERY_INVALID', 'Unsupported IDE query operation.');
    if (!args.path || !Number.isInteger(args.line) || !Number.isInteger(args.column)) {
      throw new CodeIntelligenceError('IDE_QUERY_INVALID', `${request.operation} requires target.path, line and column.`);
    }
    return this.call(sessionId, bridgeTool, { file: args.path, line: args.line, column: args.column, ...(bridgeTool !== 'hover' ? { maxResults: clamp(request.maxResults, 30, 100) } : {}) });
  }

  async diagnostics(sessionId: string, request: IdeDiagnosticsRequest): Promise<unknown> {
    if (request.scope === 'file' && !request.path) throw new CodeIntelligenceError('IDE_QUERY_INVALID', 'File diagnostics require path.');
    return this.call(sessionId, 'diagnostics', {
      ...(request.path ? { file: request.path } : {}),
      ...(request.severities ? { severities: request.severities.map((severity) => severity[0].toUpperCase() + severity.slice(1)) } : {}),
      ...(request.scope === 'project' ? { maxFiles: 50 } : {}),
      maxDiagnostics: clamp(request.maxResults, 100, 200),
    });
  }

  async stop(projectId: string): Promise<void> {
    const runtime = this.runtimes.get(projectId);
    if (!runtime) return;
    const rootHash = createHash('sha256').update(runtime.rootPath.toLowerCase()).digest('hex');
    const ownership = await inspectManagedProcess(runtime.lease, rootHash, runtime.rootPath);
    if (ownership.state === 'unverified') {
      this.failures.set(projectId, { code: 'IDE_PROCESS_OWNERSHIP_UNVERIFIED', message: ownership.reason });
      throw new CodeIntelligenceError('IDE_PROCESS_OWNERSHIP_UNVERIFIED', ownership.reason);
    }
    clearTimeout(runtime.idleTimer);
    await this.bridgeBackend.close(runtime);
    if (ownership.state === 'owned') await terminateManagedProcess(runtime.lease, rootHash, runtime.rootPath);
    this.runtimes.delete(projectId);
  }

  async restart(projectId: string): Promise<ProjectIdeStatus> {
    await this.stop(projectId);
    this.failures.delete(projectId);
    return this.statusForProject(projectId);
  }

  async test(projectId: string): Promise<ProjectIdeStatus> {
    const project = await this.getProject(projectId);
    const status = await this.statusForProject(projectId);
    if (!status.enabled) throw new CodeIntelligenceError('IDE_PROJECT_DISABLED', 'Enable the project before testing VS Code intelligence.');
    const root = project.path ? canonicalRoot(project.path) : null;
    if (!root) throw new CodeIntelligenceError('IDE_PROJECT_REQUIRED', 'The selected project has no host path.');
    await this.assertProjectEnabled(projectId, root);
    const representative = findRepresentativeFile(root);
    if (!representative) return { ...status, lifecycle: 'degraded', message: 'Bridge is connected, but no representative source file was found.' };
    await this.ensureRuntime(projectId, root);
    await this.callForProject(projectId, 'document_symbols', { file: relative(root, representative) });
    const tested = await this.statusForProject(projectId);
    if (tested.languages.some((language) => language.lifecycle === 'missing')) {
      return { ...tested, lifecycle: 'degraded', errorCode: 'IDE_LANGUAGE_PROVIDER_MISSING', message: 'VS Code Bridge is ready, but one or more detected languages have no provider.' };
    }
    if (tested.languages.some((language) => language.lifecycle === 'indexing')) return { ...tested, lifecycle: 'indexing' };
    return tested;
  }

  async onModuleDestroy(): Promise<void> {
    const runtimes = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.all(runtimes.map(async (runtime) => {
      clearTimeout(runtime.idleTimer);
      await this.bridgeBackend.close(runtime);
    }));
  }

  private async callForProject(projectId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const runtime = this.runtimes.get(projectId);
    if (!runtime) throw new CodeIntelligenceError('IDE_START_TIMEOUT', 'VS Code runtime is not ready.');
    const project = await this.getProject(projectId);
    const root = canonicalRoot(project.path);
    return sanitizeBridgeResult(unwrapBridgeResult(await runtime.client.callTool({ name: toolName, arguments: prepareBridgeArgs(root, args) })), root);
  }

  private async ensureRuntime(projectId: string, rootPath: string): Promise<Runtime> {
    const existing = this.runtimes.get(projectId);
    if (existing) { this.touch(existing); return existing; }
    const pending = this.pending.get(projectId);
    if (pending) return pending;
    const promise = this.startRuntime(projectId, rootPath);
    this.pending.set(projectId, promise);
    try { return await promise; } finally { this.pending.delete(projectId); }
  }

  private async assertProjectEnabled(projectId: string, rootPath: string): Promise<void> {
    const stored = await this.loadSettings();
    const config = stored.projects[projectId];
    if (!stored.enabled || config?.enabled !== true) {
      throw new CodeIntelligenceError('IDE_PROJECT_DISABLED', 'VS Code code intelligence is disabled for this project.');
    }
    if (!config.trustAcknowledgedAt || config.canonicalRoot !== rootPath) {
      throw new CodeIntelligenceError('IDE_PROJECT_TRUST_REQUIRED', 'Project trust must be acknowledged again for this workspace root.');
    }
    if (!await this.allowedPaths.isAllowed(rootPath)) {
      throw new CodeIntelligenceError('IDE_PROJECT_TRUST_REQUIRED', 'The project root is not an allowed host path.');
    }
  }

  private async startRuntime(projectId: string, rootPath: string): Promise<Runtime> {
    const runtimeDir = resolve(process.env['KALIO_DATA_ROOT']?.trim() || join(homedir(), '.kalio', 'runtime'), 'code-intelligence', 'vscode', safeId(projectId));
    mkdirSync(runtimeDir, { recursive: true });
    const releaseLock = await acquireRuntimeLock(join(runtimeDir, 'runtime.lock'));
    try { return await this.startRuntimeWithLock(projectId, rootPath, runtimeDir); } finally { releaseLock(); }
  }

  private async startRuntimeWithLock(projectId: string, rootPath: string, runtimeDir: string): Promise<Runtime> {
    const installation = await detectInstallation();
    if (!installation.platformSupported || !installation.codeExecutable || !installation.bridgeInstalled) throw new CodeIntelligenceError('IDE_BRIDGE_MISSING', 'VS Code or the LSP MCP Bridge is not installed.');
    if (!installation.bridgeCompatible) throw new CodeIntelligenceError('IDE_BRIDGE_INCOMPATIBLE', 'Installed Bridge version is not supported by this Kalio adapter.');
    const userDataDir = join(runtimeDir, 'user-data');
    const connectionFile = join(runtimeDir, 'connection.json');
    const leaseFile = join(runtimeDir, 'lease.json');
    mkdirSync(join(userDataDir, 'User'), { recursive: true });
    const rootHash = createHash('sha256').update(rootPath.toLowerCase()).digest('hex');
    const persistedLease = readLease(leaseFile);
    if (persistedLease) {
      const ownership = await inspectManagedProcess(persistedLease, rootHash, rootPath);
      if (ownership.state === 'unverified') throw new CodeIntelligenceError('IDE_PROCESS_OWNERSHIP_UNVERIFIED', ownership.reason);
      if (ownership.state === 'owned') {
        try {
          const descriptor = await waitForConnection(connectionFile, rootPath, ownership.lease.port);
          return this.attachRuntime(projectId, rootPath, runtimeDir, descriptor, ownership.lease);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new CodeIntelligenceError('IDE_PROCESS_OWNERSHIP_UNVERIFIED', `A managed VS Code process exists but its Bridge is not healthy: ${redactSecrets(detail)}`);
        }
      }
      clearManagedFiles(connectionFile, leaseFile);
    } else if (existsSync(connectionFile) || existsSync(leaseFile)) {
      throw new CodeIntelligenceError('IDE_PROCESS_OWNERSHIP_UNVERIFIED', 'A VS Code Bridge profile exists without a verifiable Kalio lease.');
    }
    if (this.runtimes.size >= MAX_RUNTIME_COUNT) {
      const idle = [...this.runtimes.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (idle && Date.now() - idle.lastUsedAt > IDLE_TIMEOUT_MS) {
        this.emitAudit('runtime.capacity_evicted', idle.projectId, idle.runtimeId);
        await this.stop(idle.projectId);
      }
      if (this.runtimes.size >= MAX_RUNTIME_COUNT) throw new CodeIntelligenceError('IDE_RUNTIME_CAPACITY', 'The maximum number of managed VS Code runtimes is active.');
    }
    const port = await allocatePort();
    writeFileSync(join(userDataDir, 'User', 'settings.json'), JSON.stringify({
      'vscodeLspMcpBridge.autoStart': true,
      'vscodeLspMcpBridge.host': '127.0.0.1',
      'vscodeLspMcpBridge.port': port,
      'vscodeLspMcpBridge.connectionFile': connectionFile,
      'vscodeLspMcpBridge.enableWriteTools': false,
    }, null, 2));
    const args = ['--user-data-dir', userDataDir, '--extensions-dir', extensionDir(), '--new-window', rootPath];
    const child = spawn(installation.codeExecutable, args, { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
    if (!child.pid) throw new CodeIntelligenceError('IDE_START_TIMEOUT', 'VS Code did not return a process id.');
    let lease: ManagedVscodeLease = { runtimeNonce: nanoid(), pid: child.pid, startedAt: Date.now(), rootHash, port, userDataDir, codeExecutable: installation.codeExecutable, expectedCommandLine: [installation.codeExecutable, ...args].join(' ') };
    lease = await refreshLeaseStartTime(lease, rootPath);
    writeLease(leaseFile, lease);
    this.emitAudit('runtime.start.requested', projectId);
    try {
      const descriptor = await waitForConnection(connectionFile, rootPath, port, child);
      return this.attachRuntime(projectId, rootPath, runtimeDir, descriptor, lease, child);
    } catch (error) {
      try { await terminateManagedProcess(lease, rootHash, rootPath); } catch (terminationError) { this.emitAudit('runtime.failed', projectId, undefined, undefined, 'IDE_PROCESS_OWNERSHIP_UNVERIFIED'); if (terminationError instanceof Error) error = new Error(`${error instanceof Error ? error.message : String(error)}; ${terminationError.message}`); }
      const typed = error instanceof CodeIntelligenceError ? error : new CodeIntelligenceError('IDE_START_TIMEOUT', 'Managed VS Code Bridge did not become ready before the deadline.');
      const safeMessage = redactSecrets(typed.message);
      const safeError = new CodeIntelligenceError(typed.code, safeMessage);
      this.failures.set(projectId, { code: safeError.code, message: safeError.message });
      this.emitAudit('runtime.failed', projectId, undefined, undefined, safeError.code);
      throw safeError;
    }
  }

  private async attachRuntime(projectId: string, rootPath: string, runtimeDir: string, descriptor: { token?: string; bearerToken?: string; port?: number }, lease: ManagedVscodeLease, child?: ChildProcess): Promise<Runtime> {
    const token = descriptor.token ?? descriptor.bearerToken;
    if (!token) throw new CodeIntelligenceError('IDE_START_TIMEOUT', 'VS Code Bridge did not provide an authenticated connection descriptor.');
    const connection = await this.bridgeBackend.connect(descriptor.port ?? lease.port, token);
    const runtimeId = nanoid();
    const languages = detectLanguages(rootPath);
    const lifecycle = languages.some((language) => language.lifecycle === 'indexing') ? 'indexing' : 'ready';
    const runtime: Runtime = { ...connection, runtimeId, projectId, rootPath, child, lease, languages, lifecycle, lastUsedAt: Date.now(), idleTimer: setTimeout(() => { this.emitAudit('runtime.idle_stopped', projectId, runtimeId); void this.stop(projectId); }, IDLE_TIMEOUT_MS), connectionFile: join(runtimeDir, 'connection.json'), leaseFile: join(runtimeDir, 'lease.json') };
    if (child) child.once('exit', () => { if (this.runtimes.get(projectId)?.runtimeId === runtime.runtimeId) { this.runtimes.delete(projectId); this.failures.set(projectId, { code: 'IDE_START_TIMEOUT', message: 'Managed VS Code exited unexpectedly.' }); this.emitAudit('runtime.failed', projectId, runtime.runtimeId, undefined, 'IDE_START_TIMEOUT'); } });
    this.runtimes.set(projectId, runtime);
    this.failures.delete(projectId);
    this.emitAudit('runtime.bridge.ready', projectId, runtime.runtimeId);
    this.emitAudit('runtime.ready', projectId, runtime.runtimeId);
    for (const language of runtime.languages) {
      if (language.lifecycle === 'indexing') this.emitAudit('runtime.indexing', projectId, runtime.runtimeId, language.id);
      if (language.lifecycle === 'missing') this.emitAudit('runtime.provider_missing', projectId, runtime.runtimeId, language.id);
    }
    return runtime;
  }

  private touch(runtime: Runtime): void {
    runtime.lastUsedAt = Date.now();
    clearTimeout(runtime.idleTimer);
    runtime.idleTimer = setTimeout(() => {
      this.emitAudit('runtime.idle_stopped', runtime.projectId, runtime.runtimeId);
      void this.stop(runtime.projectId);
    }, IDLE_TIMEOUT_MS);
  }

  private emitAudit(eventName: string, projectId?: string, runtimeId?: string, language?: string, errorCode?: string): void {
    void this.audit?.log({
      type: 'runtime_event',
      label: eventName,
      data: {
        domain: 'code_intelligence',
        backend: 'vscode_bridge',
        ...(projectId ? { projectId } : {}),
        ...(runtimeId ? { runtimeId } : {}),
        ...(language ? { language } : {}),
        ...(errorCode ? { errorCode } : {}),
      },
    });
  }

  private async getProject(projectId: string): Promise<{ id: string; name: string; path: string | null; isSystem: boolean }> {
    const [project] = await this.drizzle.db.select({ id: projects.id, name: projects.name, path: projects.path, isSystem: projects.isSystem }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project || project.isSystem) throw new CodeIntelligenceError('IDE_PROJECT_REQUIRED', 'A non-system workspace project is required.');
    return project;
  }

}
