import { win32 } from 'node:path';
import { fetchProtectedHitlConfig, HitlAuthorizationConfigurationError } from './devin-session-readiness.auth.mjs';

const baseAllowedTools = ['fs_list', 'fs_read', 'fs_write', 'terminal_spawn', 'terminal_list', 'terminal_output'];

// A read-only snapshot, never execution authorization or a pricing assertion.
export async function collectDevinSessionReadinessChecks(options = {}) {
  const checks = [];
  const argv = options.argv ?? [];
  const check = (ok, message) => checks.push({ ok: Boolean(ok), message });
  const projectContextFlags = argv.filter(arg => arg === '--include-project-context').length;
  check(projectContextFlags <= 1, 'Project context scope is explicit and unique');
  const allowedTools = projectContextFlags === 1
    ? [...baseAllowedTools, 'search_project_context']
    : baseAllowedTools;
  const value = flag => {
    const positions = argv.flatMap((arg, index) => arg === flag ? [index] : []);
    if (positions.length !== 1) return null;
    const candidate = argv[positions[0] + 1];
    return typeof candidate === 'string' && candidate.trim() && !candidate.startsWith('--') ? candidate.trim() : null;
  };
  const sessionId = value('--devin-session');
  const resumeRequested = argv.includes('--resume-session');
  const resumeId = value('--resume-session');
  check(!resumeRequested || (resumeId === sessionId && validId(resumeId)), 'Resume must name the exact approved Devin session');
  const expectedPath = value('--expected-project-path');
  const apiBase = value('--api');
  check(argv.filter(arg => arg === '--static-only').length === 1
    && !argv.some(arg => arg.startsWith('--static-only=')), 'Explicit static-only mode is required');
  check(Boolean(sessionId && /^[\w-]+$/.test(sessionId)), 'An explicit valid Devin session is required');
  check(isExactWindowsPath(expectedPath), 'An explicit absolute canonical Windows project path is required');
  let api;
  try { api = new URL(apiBase); } catch { api = null; }
  check(api?.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname)
    && !api.username && !api.password && !api.search && !api.hash && api.pathname === '/api',
  'An explicit loopback API origin with /api is required');
  if (checks.some(item => !item.ok)) return checks;

  const fetchJson = options.fetchJson ?? fetch;
  const now = options.now ?? Date.now();
  const read = async (path, { empty = false } = {}) => {
    try {
      const response = path === '/hitl/config'
        ? await fetchProtectedHitlConfig({ apiBase: api.href, fetchJson, env: options.env ?? process.env })
        : await fetchJson(`${api.origin}/api${path}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(45000),
      });
      if (!response.ok || response.redirected || (response.url && response.url !== `${api.origin}/api${path}`)) {
        check(false, `Endpoint rejected: ${path.split('?')[0]}`);
        return undefined;
      }
      const body = await response.text();
      if (body === '' && empty) return null;
      return JSON.parse(body);
    } catch (error) {
      if (error instanceof HitlAuthorizationConfigurationError) {
        check(false, new HitlAuthorizationConfigurationError().message);
        return undefined;
      }
      // Do not log upstream error/body: either can contain credentials or tokens.
      check(false, `Endpoint unavailable or invalid JSON: ${path.split('?')[0]}`);
      return undefined;
    }
  };
  const session = await read(`/sessions/${sessionId}`);
  check(session?.id === sessionId && session?.kind === 'chat'
    && validId(session?.projectId) && validId(session?.personaId) && validId(session?.executionProfileId),
  'Session identity, project, persona and explicit execution profile are bound');
  if (checks.some(item => !item.ok)) return checks;
  const profile = await read(`/runtime/profiles/${session.executionProfileId}`);
  check(profile?.id === session.executionProfileId && profile?.enabled === true
    && profile?.kind === 'devin-cli-acp' && profile?.model === 'swe-2' && profile?.approvalMode === 'kalio_strict',
  'Effective session profile is enabled Devin ACP / exact swe-2 / kalio_strict');
  const projects = await read('/projects');
  const matches = Array.isArray(projects) ? projects.filter(project => project?.id === session.projectId) : [];
  const context = session.runtimeContext?.architectureContext;
  check(matches.length === 1 && matches[0].kind === 'workspace'
    && samePath(matches[0].path, expectedPath) && samePath(context?.projectPath, expectedPath)
    && samePath(context?.executionCwd, expectedPath), 'Project and session execution paths match the exact approved path');
  const persona = await read(`/personas/${session.personaId}`);
  check(persona?.id === session.personaId && persona?.mcpPolicy === 'allow_list'
    && Array.isArray(persona.allowedTools) && persona.allowedTools.length === allowedTools.length
    && new Set(persona.allowedTools).size === allowedTools.length
    && allowedTools.every(tool => persona.allowedTools.includes(tool))
    && Array.isArray(persona.providerToolNames) && persona.providerToolNames.length === 0,
  `Persona allows only the ${allowedTools.length} approved Kalio tools and no provider-native tool declarations`);
  const hitl = await read('/hitl/config');
  check(hitl?.mode === 'manual' && hitl?.unattendedFallback === 'pause' && hitl?.externalPolicyEnabled === false,
    'HITL requires manual approval and pauses unattended requests');
  const settings = await read('/runtime/devin-cli/settings');
  check(settings?.mcpBridge?.enabled === true && settings.mcpBridge.configuredBy === 'settings'
    && settings.mcpBridge.transport === 'streamable-http'
    && settings.mcpBridge.url === `${api.origin}/api/mcp/bridge`
    && settings?.nativeTools?.filesystem === false && settings?.nativeTools?.terminal === false
    && typeof settings?.nativeTools?.web === 'boolean',
  'Local configured Kalio bridge is enabled; native filesystem and terminal are disabled');
  const tools = await read('/tools');
  check(Array.isArray(tools) && allowedTools.every(name => {
    const entries = tools.filter(tool => tool?.name === name);
    return entries.length === 1 && typeof entries[0].requiresConfirmation === 'boolean'
      && (!['fs_write', 'terminal_spawn', 'search_project_context'].includes(name) || entries[0].requiresConfirmation === true);
  }), 'Approved tools exist uniquely; every write and terminal spawn requires confirmation');
  const status = await read('/runtime/devin-cli/status?refresh=true');
  check(status?.authenticated === true && status?.acp === true && status?.probeChecked === true
    && status?.modelCatalogStatus === 'ready' && status?.modelCatalogStale === false
    && typeof status.modelCatalogDiscoveredAt === 'number'
    && status.modelCatalogDiscoveredAt <= now + 60000 && now - status.modelCatalogDiscoveredAt <= 300000
    && Array.isArray(status.models) && status.models.some(model => model === 'swe-2' || model?.id === 'swe-2'),
  'Refreshed authenticated ACP catalog contains exact swe-2 and is fresh');
  if (resumeRequested) {
    check(typeof session.externalThreadId === 'string' && session.externalThreadId.length > 0
      && status?.hostCount === 1 && Array.isArray(status.hosts) && status.hosts.length === 1
      && status.hosts[0].model === 'swe-2' && status.hosts[0].status === 'online'
      && typeof status.hosts[0].processEpoch === 'string' && status.hosts[0].processEpoch.length > 0,
    'Exact existing thread with one online SWE-2 host and known epoch');
  } else {
    check(status?.hostCount === 0 && Array.isArray(status?.hosts) && status.hosts.length === 0,
      'No Devin hosts exist at the time of this snapshot');
  }
  const current = await read(`/sessions/${sessionId}/runs/current`, { empty: true });
  check(current === null, 'No unresolved current run exists in the approved session');
  const children = await read(`/sessions/${sessionId}/children`);
  check(Array.isArray(children) && children.length === 0, 'No child executions require separate inspection');
  check(true, 'Static snapshot only: recheck before execution; no prompt, approval, pricing or execution authorization is implied');
  return checks;
}

function validId(value) { return typeof value === 'string' && /^[\w-]+$/.test(value); }
function isExactWindowsPath(value) {
  return typeof value === 'string' && /^[a-z]:[\\/]/i.test(value)
    && !value.split(/[\\/]/).some(part => part === '..' || part === '.' || part.includes(':') && !/^[a-z]:$/i.test(part))
    && !/[\x00-\x1f]/.test(value) && win32.isAbsolute(value);
}
function samePath(actual, expected) {
  return isExactWindowsPath(actual) && win32.normalize(actual).toLowerCase() === win32.normalize(expected).toLowerCase();
}
