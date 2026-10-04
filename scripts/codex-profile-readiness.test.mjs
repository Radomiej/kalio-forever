import test from 'node:test';
import assert from 'node:assert/strict';
import { runPaidReadinessCheck } from './agentflow-paid-readiness.mjs';

const names = ['fs_list', 'fs_read', 'fs_write', 'terminal_spawn', 'terminal_list', 'terminal_output'];
const argv = ['--api', 'http://127.0.0.1:3316/api', '--static-only', '--codex-profile', 'profile',
  '--persona', 'persona', '--expected-model', 'gpt-6-luna', '--expected-project-path', 'E:/Projekty/home-site'];
function fixture() {
  return {
    '/runtime/profiles/profile': { id: 'profile', kind: 'codex-app-server', model: 'gpt-6-luna', authProfileId: 'account', enabled: true, approvalMode: 'kalio_strict' },
    '/runtime/native-cli-integrations': [{ provider: 'codex', authProfileId: 'account', connected: true, status: 'online', openSessionCount: 0, processEpoch: 'epoch' }],
    '/runtime/native-cli-integrations/account/settings': { inheritConfiguredMcp: false },
    '/runtime/native-cli-integrations/account/models': { models: ['gpt-6-luna'], checkedAt: 1000, processEpoch: 'epoch' },
    '/projects': [{ kind: 'workspace', path: 'E:/Projekty/home-site' }],
    '/personas/persona': { id: 'persona', mcpPolicy: 'allow_list', allowedTools: names, providerToolNames: [] },
    '/hitl/config': { mode: 'manual', unattendedFallback: 'pause', externalPolicyEnabled: false },
    '/tools': names.map(name => ({ name, requiresConfirmation: true })),
  };
}
async function run(routes = fixture(), args = argv) {
  const requests = [];
  const output = [];
  const exit = await runPaidReadinessCheck({ argv: args, now: 1000, stdout: text => output.push(text), stderr: text => output.push(text),
    fetchJson: async (url, init) => {
      requests.push({ url, init });
      const key = new URL(url).pathname.replace('/api', '');
      return new Response(JSON.stringify(routes[key]), { status: key in routes ? 200 : 404 });
    } });
  return { exit, output, requests };
}
test('Codex prelaunch gate is GET-only and does not test unrelated global credentials', async () => {
  const result = await run();
  assert.equal(result.exit, 0, result.output.join('\n'));
  assert.equal(result.requests.length, 8);
  assert.ok(result.requests.every(({ init }) => init.method === 'GET'));
  assert.ok(result.requests.every(({ url }) => !url.includes('/credentials') && !url.includes('/check')));
});
for (const [label, mutate] of [
  ['disabled profile', r => { r['/runtime/profiles/profile'].enabled = false; }],
  ['wrong model', r => { r['/runtime/profiles/profile'].model = 'gpt-5.4'; }],
  ['guard approval', r => { r['/runtime/profiles/profile'].approvalMode = 'codex_guard'; }],
  ['offline', r => { r['/runtime/native-cli-integrations'][0].connected = false; }],
  ['open session', r => { r['/runtime/native-cli-integrations'][0].openSessionCount = 1; }],
  ['inherited MCP', r => { r['/runtime/native-cli-integrations/account/settings'].inheritConfiguredMcp = true; }],
  ['stale catalog', r => { r['/runtime/native-cli-integrations/account/models'].checkedAt = -400000; }],
  ['different epoch', r => { r['/runtime/native-cli-integrations/account/models'].processEpoch = 'old'; }],
  ['unknown epoch', r => { delete r['/runtime/native-cli-integrations'][0].processEpoch; delete r['/runtime/native-cli-integrations/account/models'].processEpoch; }],
  ['wrong project', r => { r['/projects'][0].path = 'E:/Projekty/other'; }],
  ['automatic approval', r => { r['/hitl/config'].mode = 'auto'; }],
  ['native tools', r => { r['/personas/persona'].providerToolNames = ['exec']; }],
  ['write confirmation off', r => { r['/tools'].find(tool => tool.name === 'fs_write').requiresConfirmation = false; }],
]) test(`Codex readiness rejects ${label}`, async () => {
  const routes = fixture(); mutate(routes);
  assert.equal((await run(routes)).exit, 1);
});
test('missing static authorization fails before any request', async () => {
  const result = await run(fixture(), argv.filter(arg => arg !== '--static-only'));
  assert.equal(result.exit, 1); assert.equal(result.requests.length, 0);
});

test('old catalog reports age separately from host epoch and model membership', async () => {
  const routes = fixture();
  routes['/runtime/native-cli-integrations/account/models'].checkedAt = -400000;
  const result = await run(routes);
  assert.equal(result.exit, 1);
  assert.ok(result.output.some(line => line.includes('PASS Model catalog matches current process epoch')));
  assert.ok(result.output.some(line => line.includes('FAIL Model catalog checked within five minutes')));
  assert.ok(result.output.some(line => line.includes('PASS Exact requested model exists in host catalog')));
});

function resumeFixture() {
  const routes = fixture();
  routes['/runtime/native-cli-integrations'][0].openSessionCount = 1;
  routes['/sessions/session'] = { id: 'session', kind: 'chat', personaId: 'persona', executionProfileId: 'profile',
    externalThreadId: 'thread', runtimeContext: { architectureContext: {
      projectPath: 'E:/Projekty/home-site', executionCwd: 'E:/Projekty/home-site',
    } } };
  routes['/sessions/session/runs/current'] = null;
  routes['/sessions/session/children'] = [];
  return routes;
}
test('explicit resume accepts an idle registered thread using scoped GET-only checks', async () => {
  const result = await run(resumeFixture(), [...argv, '--resume-session', 'session']);
  assert.equal(result.exit, 0, result.output.join('\n'));
  assert.equal(result.requests.length, 11);
  assert.ok(result.requests.every(({ init }) => init.method === 'GET'));
});
for (const [label, mutate] of [
  ['active run', r => { r['/sessions/session/runs/current'] = { status: 'running' }; }],
  ['children', r => { r['/sessions/session/children'] = [{ id: 'child' }]; }],
  ['wrong profile', r => { r['/sessions/session'].executionProfileId = 'other'; }],
  ['wrong cwd', r => { r['/sessions/session'].runtimeContext.architectureContext.executionCwd = 'E:/other'; }],
  ['missing run endpoint', r => { delete r['/sessions/session/runs/current']; }],
]) test(`resume rejects ${label}`, async () => {
  const routes = resumeFixture(); mutate(routes);
  assert.equal((await run(routes, [...argv, '--resume-session', 'session'])).exit, 1);
});
