import test from 'node:test';
import assert from 'node:assert/strict';
import { runPaidReadinessCheck } from './agentflow-paid-readiness.mjs';

const argv = ['--api', 'http://127.0.0.1:3316/api', '--static-only',
  '--devin-session', 'session-1', '--expected-project-path', 'E:\\Projekty\\home-site'];
const names = ['fs_list', 'fs_read', 'fs_write', 'terminal_spawn', 'terminal_list', 'terminal_output'];
const testToken = 'a'.repeat(64);
function fixtures() {
  return {
    '/sessions/session-1': { id: 'session-1', kind: 'chat', projectId: 'project-1', personaId: 'persona-1', executionProfileId: 'profile-1',
      runtimeContext: { architectureContext: { projectPath: 'E:/Projekty/home-site', executionCwd: 'E:/Projekty/home-site' } } },
    '/runtime/profiles/profile-1': { id: 'profile-1', enabled: true, kind: 'devin-cli-acp', model: 'swe-2', approvalMode: 'kalio_strict' },
    '/projects': [{ id: 'project-1', kind: 'workspace', path: 'E:/Projekty/home-site' }],
    '/personas/persona-1': { id: 'persona-1', allowedTools: names, providerToolNames: [], mcpPolicy: 'allow_list' },
    '/hitl/config': { mode: 'manual', unattendedFallback: 'pause', externalPolicyEnabled: false },
    '/runtime/devin-cli/settings': { mcpBridge: { enabled: true, configuredBy: 'settings', transport: 'streamable-http', url: 'http://127.0.0.1:3316/api/mcp/bridge' },
      nativeTools: { filesystem: false, terminal: false, web: true } },
    '/runtime/devin-cli/status?refresh=true': { authenticated: true, acp: true, probeChecked: true, modelCatalogStatus: 'ready',
      modelCatalogStale: false, modelCatalogDiscoveredAt: 10000, models: ['swe-2'], hostCount: 0, hosts: [] },
    '/tools': names.map(name => ({ name, requiresConfirmation: ['fs_write', 'terminal_spawn'].includes(name) })),
    '/sessions/session-1/runs/current': null,
    '/sessions/session-1/children': [],
  };
}
async function run(routes = fixtures(), extra = {}) {
  const requests = [];
  const output = [];
  const exit = await runPaidReadinessCheck({ argv, now: 10000, env: { KALIO_CONTROL_PLANE_TOKEN: testToken }, stdout: line => output.push(line), stderr: line => output.push(line),
    fetchJson: async (url, init) => {
      requests.push({ url, init });
      const key = new URL(url).pathname.replace('/api', '') + new URL(url).search;
      if (!(key in routes)) return new Response('{}', { status: 404 });
      return new Response(routes[key] === null ? '' : JSON.stringify(routes[key]), { status: 200 });
    }, ...extra });
  return { exit, requests, output };
}
test('explicit Devin readiness verifies the session without global credentials or any writes', async () => {
  const result = await run();
  assert.equal(result.exit, 0, result.output.join('\n'));
  assert.ok(result.requests.length >= 10);
  assert.ok(result.requests.every(request => !request.init?.method || request.init.method === 'GET'));
  assert.ok(result.requests.every(request => !request.url.includes('/credentials')));
});
test('Devin readiness permits only the explicitly requested, confirmation-gated project search tool', async () => {
  const routes = fixtures();
  const projectContextTools = [...names, 'search_project_context'];
  routes['/personas/persona-1'].allowedTools = projectContextTools;
  routes['/tools'].push({ name: 'search_project_context', requiresConfirmation: true });
  const result = await run(routes, { argv: [...argv, '--include-project-context'] });
  assert.equal(result.exit, 0, result.output.join('\n'));

  routes['/tools'].find(tool => tool.name === 'search_project_context').requiresConfirmation = false;
  assert.equal((await run(routes, { argv: [...argv, '--include-project-context'] })).exit, 1);
});
test('Devin readiness rejects an unconfirmed or duplicate project-context scope flag', async () => {
  const routes = fixtures();
  const projectContextTools = [...names, 'search_project_context'];
  routes['/personas/persona-1'].allowedTools = projectContextTools;
  routes['/tools'].push({ name: 'search_project_context', requiresConfirmation: false });
  assert.equal((await run(routes, { argv: [...argv, '--include-project-context'] })).exit, 1);
  routes['/tools'].find(tool => tool.name === 'search_project_context').requiresConfirmation = true;
  assert.equal((await run(routes, { argv: [...argv, '--include-project-context', '--include-project-context'] })).exit, 1);
});
test('protected HITL GET authenticates a real 401 contract and sends bearer only to that exact route', async () => {
  const routes = fixtures();
  const requests = [];
  const result = await run(routes, { fetchJson: async (url, init) => {
    requests.push({ url, init });
    const key = new URL(url).pathname.replace('/api', '') + new URL(url).search;
    if (key === '/hitl/config' && init.headers?.Authorization !== `Bearer ${testToken}`) {
      return new Response('{"code":"DECISION_AUTH_REQUIRED"}', { status: 401 });
    }
    return new Response(routes[key] === null ? '' : JSON.stringify(routes[key]), { status: 200 });
  } });
  assert.equal(result.exit, 0, result.output.join('\n'));
  assert.equal(requests.filter(request => request.init.headers?.Authorization).length, 1);
  assert.equal(requests.find(request => request.init.headers?.Authorization)?.url, 'http://127.0.0.1:3316/api/hitl/config');
  assert.ok(requests.every(request => request.init.method === 'GET' && request.init.redirect === 'error'));
  assert.ok(!result.output.join('\n').includes(testToken));
});

test('protected HITL auth fails closed before sending when env bearer is absent or malformed', async () => {
  for (const env of [{}, { KALIO_CONTROL_PLANE_TOKEN: '' }, { KALIO_CONTROL_PLANE_TOKEN: 'SECRET-invalid' }]) {
    const result = await run(fixtures(), { env });
    assert.equal(result.exit, 1);
    assert.ok(!result.requests.some(request => new URL(request.url).pathname === '/api/hitl/config'));
    assert.ok(result.output.some(line => line.includes('HITL authorization is not configured')));
    assert.ok(!result.output.some(line => line.includes('Endpoint unavailable or invalid JSON: /hitl/config')));
    assert.ok(!result.output.join('\n').includes('SECRET'));
  }
});

test('protected HITL 401, redirect, wrong response origin and failures never retry or leak tokens', async () => {
  for (const protectedResponse of [
    () => new Response(testToken, { status: 401 }),
    () => new Response(null, { status: 302, headers: { location: `https://evil.example/${testToken}` } }),
    () => ({ ok: true, redirected: true, url: 'https://evil.example/api/hitl/config', text: async () => testToken }),
    () => ({ ok: true, redirected: false, url: 'http://localhost:5288/api/hitl/config', text: async () => testToken }),
    () => { throw new Error(testToken); },
  ]) {
    const routes = fixtures();
    let protectedCalls = 0;
    const result = await run(routes, { fetchJson: async (url, init) => {
      const key = new URL(url).pathname.replace('/api', '') + new URL(url).search;
      if (key === '/hitl/config') {
        protectedCalls += 1;
        assert.equal(init.redirect, 'error');
        return protectedResponse();
      }
      assert.equal(init.headers?.Authorization, undefined);
      return new Response(routes[key] === null ? '' : JSON.stringify(routes[key]), { status: 200 });
    } });
    assert.equal(result.exit, 1);
    assert.equal(protectedCalls, 1);
    assert.ok(!result.output.join('\n').includes(testToken));
  }
});

test('foreign API origin is rejected before any token or request is sent', async () => {
  const result = await run(fixtures(), { argv: argv.map(arg => arg === 'http://127.0.0.1:3316/api' ? 'http://evil.example:3316/api' : arg) });
  assert.equal(result.exit, 1);
  assert.equal(result.requests.length, 0);
  assert.ok(!result.output.join('\n').includes(testToken));
});
for (const [label, mutate] of [
  ['cross-session response', r => { r['/sessions/session-1'].id = 'other'; }],
  ['cross-profile response', r => { r['/runtime/profiles/profile-1'].id = 'other'; }],
  ['wrong project', r => { r['/projects'][0].path = 'E:/Projekty/home-site-other'; }],
  ['wrong execution cwd', r => { r['/sessions/session-1'].runtimeContext.architectureContext.executionCwd = 'E:/Projekty'; }],
  ['paid or fallback model', r => { r['/runtime/profiles/profile-1'].model = 'swe-2-high'; }],
  ['permissive approval', r => { r['/runtime/profiles/profile-1'].approvalMode = 'auto'; }],
  ['stale catalog', r => { r['/runtime/devin-cli/status?refresh=true'].modelCatalogStale = true; }],
  ['old catalog timestamp', r => { r['/runtime/devin-cli/status?refresh=true'].modelCatalogDiscoveredAt = -1000000; }],
  ['native terminal', r => { r['/runtime/devin-cli/settings'].nativeTools.terminal = true; }],
  ['external bridge', r => { r['/runtime/devin-cli/settings'].mcpBridge.url = 'https://example.com/mcp'; }],
  ['automatic HITL', r => { r['/hitl/config'].mode = 'auto'; }],
  ['unattended fallback', r => { r['/hitl/config'].unattendedFallback = 'approve'; }],
  ['duplicate allowed tools', r => { r['/personas/persona-1'].allowedTools = [...names, 'fs_write']; }],
  ['broader tools', r => { r['/personas/persona-1'].allowedTools = [...names, 'fs_delete']; }],
  ['native provider tools', r => { r['/personas/persona-1'].providerToolNames = ['terminal']; }],
  ['disabled write confirmation', r => { r['/tools'].find(t => t.name === 'fs_write').requiresConfirmation = false; }],
  ['active host', r => { r['/runtime/devin-cli/status?refresh=true'].hostCount = 1; }],
  ['current run', r => { r['/sessions/session-1/runs/current'] = { sessionId: 'session-1', status: 'active' }; }],
  ['children needing inspection', r => { r['/sessions/session-1/children'] = [{ id: 'child' }]; }],
]) test(`Devin readiness fails closed for ${label}`, async () => {
  const routes = fixtures(); mutate(routes);
  assert.equal((await run(routes)).exit, 1);
});
test('Devin static readiness refuses missing static-only or expected path', async () => {
  assert.equal((await run(fixtures(), { argv: argv.filter(a => a !== '--static-only') })).exit, 1);
  assert.equal((await run(fixtures(), { argv: argv.slice(0, -2) })).exit, 1);
});
test('Devin readiness rejects redirects, malformed JSON and network failure without leaking details', async () => {
  for (const fetchJson of [
    async () => new Response(null, { status: 302, headers: { location: 'https://example.com' } }),
    async () => new Response('SECRET-invalid-json'),
    async () => { throw new Error('SECRET-network'); },
  ]) {
    const result = await run(fixtures(), { fetchJson });
    assert.equal(result.exit, 1);
    assert.ok(!result.output.join('\n').includes('SECRET'));
  }
});

function resumeFixtures() {
  const routes = fixtures();
  routes['/sessions/session-1'].externalThreadId = 'existing-thread';
  const status = routes['/runtime/devin-cli/status?refresh=true'];
  status.hostCount = 1;
  status.hosts = [{ model: 'swe-2', status: 'online', processEpoch: 'epoch' }];
  return routes;
}
const resumeArgv = [...argv, '--resume-session', 'session-1'];
test('Devin explicit idle resume is GET-only without resetting the existing host', async () => {
  const result = await run(resumeFixtures(), { argv: resumeArgv });
  assert.equal(result.exit, 0, result.output.join('\n'));
  assert.ok(result.requests.every(request => request.init.method === 'GET'));
});
for (const [label, mutate] of [
  ['wrong model host', r => { r['/runtime/devin-cli/status?refresh=true'].hosts[0].model = 'swe-2-high'; }],
  ['unknown epoch', r => { delete r['/runtime/devin-cli/status?refresh=true'].hosts[0].processEpoch; }],
  ['missing thread', r => { delete r['/sessions/session-1'].externalThreadId; }],
  ['active run', r => { r['/sessions/session-1/runs/current'] = { status: 'running' }; }],
  ['children', r => { r['/sessions/session-1/children'] = [{ id: 'child' }]; }],
]) test(`Devin resume rejects ${label}`, async () => {
  const routes = resumeFixtures(); mutate(routes);
  assert.equal((await run(routes, { argv: resumeArgv })).exit, 1);
});
