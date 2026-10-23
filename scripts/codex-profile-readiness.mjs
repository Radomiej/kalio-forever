import { win32 } from 'node:path';

const names = ['fs_list', 'fs_read', 'fs_write', 'terminal_spawn', 'terminal_list', 'terminal_output'];
export async function collectCodexProfileReadinessChecks(options = {}) {
  const checks = [];
  const argv = options.argv ?? [];
  const check = (ok, message) => checks.push({ ok: Boolean(ok), message });
  const value = flag => {
    if (argv.filter(arg => arg === flag).length !== 1) return null;
    const candidate = argv[argv.indexOf(flag) + 1];
    return typeof candidate === 'string' && candidate.trim() && !candidate.startsWith('--') ? candidate.trim() : null;
  };
  const profileId = value('--codex-profile');
  const personaId = value('--persona');
  const model = value('--expected-model');
  const path = value('--expected-project-path');
  const resumeRequested = argv.includes('--resume-session');
  const resumeSession = value('--resume-session');
  check(!resumeRequested || (resumeSession && /^[\w-]+$/.test(resumeSession)), 'Explicit valid resume session when requested');
  let api;
  try { api = new URL(value('--api')); } catch { api = null; }
  check(argv.filter(arg => arg === '--static-only').length === 1, 'Explicit static-only Codex prelaunch snapshot');
  check(profileId && /^[\w-]+$/.test(profileId) && personaId && /^[\w-]+$/.test(personaId) && model,
    'Exact profile, persona and model supplied');
  check(path && /^[a-z]:[\\/]/i.test(path) && win32.isAbsolute(path)
    && !path.split(/[\\/]/).some(part => part === '..' || part === '.'), 'Absolute project path without traversal');
  check(api?.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(api.hostname)
    && api.pathname === '/api' && !api.username && !api.password && !api.search && !api.hash, 'Loopback API required');
  if (checks.some(item => !item.ok)) return checks;
  const read = async endpoint => {
    try {
      const response = await (options.fetchJson ?? fetch)(`${api.origin}/api${endpoint}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || response.redirected) { check(false, `Endpoint rejected: ${endpoint}`); return undefined; }
      const body = await response.text();
      return body === '' && endpoint.endsWith('/runs/current') ? null : JSON.parse(body);
    } catch { check(false, `Endpoint unavailable: ${endpoint}`); return undefined; }
  };
  const profile = await read(`/runtime/profiles/${profileId}`);
  check(profile?.id === profileId && profile.enabled === true && profile.kind === 'codex-app-server'
    && profile.model === model && profile.approvalMode === 'kalio_strict' && !profile.provider,
  'Exact enabled Codex model with strict Kalio approval');
  if (checks.some(item => !item.ok)) return checks;
  const account = profile.authProfileId || profile.id;
  const integrations = await read('/runtime/native-cli-integrations');
  const matches = Array.isArray(integrations) ? integrations.filter(item => item.authProfileId === account && item.provider === 'codex') : [];
  const host = matches[0];
  check(matches.length === 1 && host.connected === true && host.status === 'online'
    && Number.isInteger(host.openSessionCount) && host.openSessionCount >= 0
    && (resumeRequested || host.openSessionCount === 0),
    resumeRequested ? 'One online Codex host; registered threads are not active turns' : 'One online Codex host without open sessions');
  if (resumeRequested) {
    const session = await read(`/sessions/${resumeSession}`);
    const current = await read(`/sessions/${resumeSession}/runs/current`);
    const children = await read(`/sessions/${resumeSession}/children`);
    const context = session?.runtimeContext?.architectureContext;
    const samePath = candidate => typeof candidate === 'string'
      && win32.normalize(candidate).toLowerCase() === win32.normalize(path).toLowerCase();
    check(session?.id === resumeSession && session.kind === 'chat' && session.personaId === personaId
      && session.executionProfileId === profileId && typeof session.externalThreadId === 'string'
      && session.externalThreadId.length > 0 && samePath(context?.projectPath) && samePath(context?.executionCwd),
    'Resume session binds exact profile, persona, external thread and approved paths');
    check(current === null && Array.isArray(children) && children.length === 0,
      'Resume session has no unresolved run or child executions');
  }
  const policy = await read(`/runtime/native-cli-integrations/${encodeURIComponent(account)}/settings`);
  check(policy?.inheritConfiguredMcp === false, 'External configured Codex MCP inheritance disabled');
  const catalog = await read(`/runtime/native-cli-integrations/${encodeURIComponent(account)}/models`);
  const now = options.now ?? Date.now();
  check(typeof host?.processEpoch === 'string' && host.processEpoch.length > 0
    && typeof catalog?.processEpoch === 'string' && catalog.processEpoch.length > 0
    && catalog.processEpoch === host.processEpoch, 'Model catalog matches current process epoch');
  check(typeof catalog?.checkedAt === 'number'
    && now - catalog.checkedAt <= 300000 && catalog.checkedAt <= now + 60000,
  'Model catalog checked within five minutes; use scoped Recheck if expired');
  check(Array.isArray(catalog?.models) && catalog.models.includes(model), 'Exact requested model exists in host catalog');
  const projects = await read('/projects');
  check(Array.isArray(projects) && projects.filter(project => project.kind === 'workspace'
    && typeof project.path === 'string' && win32.normalize(project.path).toLowerCase() === win32.normalize(path).toLowerCase()).length === 1,
  'Unique approved workspace exists');
  const persona = await read(`/personas/${personaId}`);
  check(persona?.id === personaId && persona.mcpPolicy === 'allow_list' && Array.isArray(persona.allowedTools)
    && persona.allowedTools.length === names.length && new Set(persona.allowedTools).size === names.length
    && names.every(name => persona.allowedTools.includes(name)) && Array.isArray(persona.providerToolNames)
    && persona.providerToolNames.length === 0, 'Persona exposes only six Kalio tools');
  const hitl = await read('/hitl/config');
  check(hitl?.mode === 'manual' && hitl.unattendedFallback === 'pause' && hitl.externalPolicyEnabled === false, 'Manual HITL pauses unattended requests');
  const tools = await read('/tools');
  check(Array.isArray(tools) && names.every(name => {
    const matches = tools.filter(tool => tool.name === name);
    return matches.length === 1 && (!['fs_write', 'terminal_spawn'].includes(name) || matches[0].requiresConfirmation === true);
  }), 'Approved tools unique; writes/spawns require confirmation');
  check(true, 'Snapshot only; UI session binding, authorization and live execution still require proof');
  return checks;
}
