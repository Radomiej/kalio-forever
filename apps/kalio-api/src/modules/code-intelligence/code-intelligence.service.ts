import { Injectable } from '@nestjs/common';
import type {
  CodeIntelligenceIntegrationPatch,
  CodeIntelligenceIntegrationStatus,
  IdeDiagnosticsRequest,
  IdeDiagnosticsResult,
  IdeQueryRequest,
  IdeQueryResult,
  ProjectIdeIntegrationPatch,
  ProjectIdeStatus,
  ToolCallRequest,
} from '@kalio/types';
import { CodeIntelligenceError, isCodeIntelligenceError } from './code-intelligence.errors';
import { ProjectIdeRuntimeManager } from './project-ide-runtime.manager';

@Injectable()
export class CodeIntelligenceService {
  constructor(private readonly runtimes: ProjectIdeRuntimeManager) {}

  async getIntegration(): Promise<CodeIntelligenceIntegrationStatus> {
    const settings = await this.runtimes.loadSettings();
    const installation = await this.runtimes.getInstallation();
    return {
      backend: 'vscode_bridge',
      platformSupported: installation.platformSupported,
      enabled: settings.enabled,
      autoStart: settings.autoStart,
      ...(installation.codeExecutable ? { codeExecutable: installation.codeExecutable } : {}),
      ...(installation.vscodeVersion ? { vscodeVersion: installation.vscodeVersion } : {}),
      bridgeInstalled: installation.bridgeInstalled,
      ...(installation.bridgeVersion ? { bridgeVersion: installation.bridgeVersion } : {}),
      bridgeCompatible: installation.bridgeCompatible,
      writeToolsEnabled: false,
      sandboxSupported: false,
      maxManagedRuntimes: 2,
      activeRuntimeCount: this.runtimes.getActiveRuntimeCount(),
      idleTimeoutMinutes: 10,
      projects: await this.runtimes.statusForAllProjects(),
    };
  }

  async updateIntegration(patch: CodeIntelligenceIntegrationPatch): Promise<CodeIntelligenceIntegrationStatus> {
    await this.runtimes.updateSettings({
      ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
      ...(typeof patch.autoStart === 'boolean' ? { autoStart: patch.autoStart } : {}),
    });
    return this.getIntegration();
  }

  async detect(): Promise<CodeIntelligenceIntegrationStatus> {
    await this.runtimes.recordDetection();
    return this.getIntegration();
  }

  async getProject(projectId: string): Promise<ProjectIdeStatus> {
    return this.runtimes.statusForProject(projectId);
  }

  async updateProject(projectId: string, patch: ProjectIdeIntegrationPatch): Promise<ProjectIdeStatus> {
    return this.runtimes.setProjectConfig(projectId, patch.enabled, patch.acknowledgedRisk === true);
  }

  async testProject(projectId: string): Promise<ProjectIdeStatus> {
    return this.runtimes.test(projectId);
  }

  async restartProject(projectId: string): Promise<ProjectIdeStatus> {
    await this.runtimes.restart(projectId);
    return this.runtimes.test(projectId);
  }

  async stopProject(projectId: string): Promise<ProjectIdeStatus> {
    await this.runtimes.stop(projectId);
    return this.runtimes.statusForProject(projectId);
  }

  async executeQuery(request: ToolCallRequest): Promise<IdeQueryResult> {
    const query = parseQueryRequest(request.args);
    const data = await this.runtimes.query(request.sessionId, query);
    return {
      operation: query.operation,
      items: extractItems(data),
      locations: extractLocations(data),
      truncated: containsTruncation(data),
      backend: 'vscode_bridge',
    };
  }

  async executeDiagnostics(request: ToolCallRequest): Promise<IdeDiagnosticsResult> {
    const diagnostics = parseDiagnosticsRequest(request.args);
    const data = await this.runtimes.diagnostics(request.sessionId, diagnostics);
    return {
      scope: diagnostics.scope,
      diagnostics: extractDiagnostics(data),
      truncated: diagnostics.scope === 'project' || containsTruncation(data),
      backend: 'vscode_bridge',
    };
  }

  async executeStatus(request: ToolCallRequest): Promise<Record<string, unknown>> {
    try {
      const scope = await this.runtimes.resolveSessionScope(request.sessionId);
      const status = await this.runtimes.statusForProject(scope.projectId);
      return toAgentStatus(status);
    } catch (error) {
      if (!isCodeIntelligenceError(error)) throw error;
      return {
        backend: 'vscode_bridge',
        lifecycle: 'error',
        enabled: false,
        workspaceTrusted: false,
        bridgeCompatible: false,
        ownership: 'none',
        languages: [],
        capabilities: [],
        errorCode: error.code,
        message: error.message,
      };
    }
  }
}

function parseQueryRequest(args: Record<string, unknown>): IdeQueryRequest {
  const operation = args['operation'];
  if (typeof operation !== 'string') throw new CodeIntelligenceError('IDE_QUERY_INVALID', 'operation is required.');
  const targetValue = args['target'];
  const target = targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)
    ? targetValue as IdeQueryRequest['target']
    : undefined;
  const maxResults = typeof args['maxResults'] === 'number' ? args['maxResults'] : undefined;
  return {
    operation: operation as IdeQueryRequest['operation'],
    ...(target ? { target } : {}),
    ...(typeof args['query'] === 'string' ? { query: args['query'] } : {}),
    ...(maxResults === undefined ? {} : { maxResults }),
  };
}

function parseDiagnosticsRequest(args: Record<string, unknown>): IdeDiagnosticsRequest {
  const scope = args['scope'];
  if (scope !== 'file' && scope !== 'project') throw new CodeIntelligenceError('IDE_QUERY_INVALID', 'scope must be file or project.');
  const severities = Array.isArray(args['severities'])
    ? args['severities'].filter((value): value is 'error' | 'warning' | 'information' => value === 'error' || value === 'warning' || value === 'information')
    : undefined;
  return {
    scope,
    ...(typeof args['path'] === 'string' ? { path: args['path'] } : {}),
    ...(severities && severities.length > 0 ? { severities } : {}),
    ...(typeof args['maxResults'] === 'number' ? { maxResults: args['maxResults'] } : {}),
  };
}

function toAgentStatus(status: ProjectIdeStatus): Record<string, unknown> {
  const safe: Record<string, unknown> = { ...status };
  delete safe['canonicalRoot'];
  delete safe['projectName'];
  return safe;
}

function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.slice(0, 100);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['items', 'symbols', 'results', 'nodes', 'content']) if (Array.isArray(record[key])) return (record[key] as unknown[]).slice(0, 100);
    return [value];
  }
  return value === undefined ? [] : [value];
}

function extractLocations(value: unknown): Array<{ path?: string; line?: number; column?: number; endLine?: number; endColumn?: number }> {
  const items = extractItems(value);
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const path = typeof record['file'] === 'string' ? record['file'] : typeof record['path'] === 'string' ? record['path'] : undefined;
    const line = typeof record['line'] === 'number' ? record['line'] : undefined;
    const column = typeof record['column'] === 'number' ? record['column'] : undefined;
    return path || line || column ? [{ path, line, column }] : [];
  });
}

function extractDiagnostics(value: unknown): Array<{ path?: string; line?: number; column?: number; severity?: string; source?: string; code?: string | number; message: string }> {
  const items = extractItems(value);
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record['message'] !== 'string') return [];
    return [{
      message: record['message'],
      ...(typeof record['file'] === 'string' ? { path: record['file'] } : {}),
      ...(typeof record['path'] === 'string' ? { path: record['path'] } : {}),
      ...(typeof record['line'] === 'number' ? { line: record['line'] } : {}),
      ...(typeof record['column'] === 'number' ? { column: record['column'] } : {}),
      ...(typeof record['severity'] === 'string' ? { severity: record['severity'] } : {}),
      ...(typeof record['source'] === 'string' ? { source: record['source'] } : {}),
      ...(typeof record['code'] === 'string' || typeof record['code'] === 'number' ? { code: record['code'] } : {}),
    }];
  });
}

function containsTruncation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsTruncation);
  const record = value as Record<string, unknown>;
  return record['truncated'] === true || Object.values(record).some(containsTruncation);
}
