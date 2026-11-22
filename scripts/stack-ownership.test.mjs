import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { preflightStackStop, recordStartupListeners } from './stack-ownership.mjs';

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url));
async function listener() {
  const child = spawn(process.execPath, ['-e', `const http=require('http');const s=http.createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end('{}')});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const [output] = await once(child.stdout, 'data');
  const port = Number(output.toString().trim());
  assert.ok(port > 0);
  return { child, pid: child.pid, port };
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function cleanup(entry) {
  if (alive(entry.pid)) { const exit = once(entry.child, 'exit'); entry.child.kill(); await exit; }
}
function fixture(state) {
  const root = mkdtempSync(join(tmpdir(), 'kalio-owned-stack-'));
  mkdirSync(join(root, 'scripts'));
  for (const name of ['stack-manager.mjs', 'stack-ownership.mjs', 'stack-port-owners.mjs', 'stack-status.mjs', 'stack-state.mjs', 'stack-qa-env.mjs']) {
    copyFileSync(join(scriptDirectory, name), join(root, 'scripts', name));
  }
  const stateDirectory = join(root, '.tmp', 'qa-stack');
  mkdirSync(stateDirectory, { recursive: true });
  const statePath = join(stateDirectory, 'qa-stack-state.json');
  const lastPath = join(stateDirectory, 'qa-stack-last-state.json');
  const content = JSON.stringify(state);
  writeFileSync(statePath, content);
  writeFileSync(lastPath, content);
  return { root, statePath, lastPath, content, run: args => spawnSync(process.execPath, [join(root, 'scripts', 'stack-manager.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 20000, windowsHide: true }) };
}
function stateFor(first, second = first) {
  return { backendPort: first.port, frontendPort: second.port, backend: { pid: first.pid }, frontend: { pid: second.pid } };
}

test('stale state never adopts a foreign listener during status, stop, or force restart', async () => {
  const foreign = await listener();
  const state = stateFor(foreign);
  state.backend.pid = state.frontend.pid = 2147483647;
  const f = fixture(state);
  try {
    assert.equal(f.run(['status', '--json']).status, 0);
    for (const args of [['stop'], ['start'], ['start', '--force-restart']]) {
      const result = f.run(args);
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, /belongs to pid/);
      assert.equal(alive(foreign.pid), true);
      assert.equal(readFileSync(f.statePath, 'utf8'), f.content);
      assert.equal(readFileSync(f.lastPath, 'utf8'), f.content);
    }
  } finally { await cleanup(foreign); rmSync(f.root, { recursive: true, force: true }); }
});

test('matching recorded listener is stopped and state is cleared', async () => {
  const managed = await listener();
  const state = stateFor(managed);
  state.backend.listenerPid = state.frontend.listenerPid = managed.pid;
  state.backend.pid = state.frontend.pid = 2147483647;
  const f = fixture(state);
  try {
    const before = f.run(['status', '--json']);
    assert.equal(before.status, 0, before.stderr);
    const report = JSON.parse(before.stdout);
    assert.equal(report.backendUp, true);
    assert.equal(report.frontendUp, true);
    assert.equal(readFileSync(f.statePath, 'utf8'), f.content);
    const result = f.run(['stop']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(alive(managed.pid), false);
    assert.equal(existsSync(f.statePath), false);
    assert.equal(existsSync(f.lastPath), false);
  } finally { await cleanup(managed); rmSync(f.root, { recursive: true, force: true }); }
});

test('frontend mismatch aborts the entire stop before terminating the matching backend', async () => {
  const managed = await listener();
  const foreign = await listener();
  const state = stateFor(managed, foreign);
  state.frontend.pid = 2147483647;
  const f = fixture(state);
  try {
    const result = f.run(['stop']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /frontend.*belongs to pid/);
    assert.equal(alive(managed.pid), true);
    assert.equal(alive(foreign.pid), true);
    assert.equal(readFileSync(f.statePath, 'utf8'), f.content);
  } finally { await cleanup(managed); await cleanup(foreign); rmSync(f.root, { recursive: true, force: true }); }
});

test('unknown ownership with a live recorded PID fails closed', async () => {
  const state = { backendPort: 10001, frontendPort: 10002, backend: { pid: 11 }, frontend: { pid: 12 } };
  await assert.rejects(preflightStackStop(state, () => true, { owners: async () => new Map(), free: async () => assert.fail('must not treat a live process as stopped') }), /ownership unknown/);
});

test('startup records verified listener children without replacing launcher identity', async () => {
  const state = { backendPort: 10001, frontendPort: 10002, backend: { pid: 11 }, frontend: { pid: 12 } };
  const original = structuredClone(state);
  const recorded = await recordStartupListeners(state, {
    owners: async () => new Map([[10001, 11], [10002, 14]]),
    parents: async () => new Map([[14, 13], [13, 12]]),
  });
  assert.deepEqual(state, original);
  assert.equal(recorded.frontend.pid, 12);
  assert.equal(recorded.frontend.listenerPid, 14);
  await assert.rejects(recordStartupListeners(state, { owners: async () => new Map([[10001, 11], [10002, 99]]), parents: async () => new Map([[99, 98]]) }), /not a child/);
});

test('real wrapper startup records its listener child and stops that child rather than a stale launcher', async () => {
  const backend = await listener();
  const payload = `const s=require('http').createServer((q,r)=>r.end('{}'));s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,port:s.address().port})));`;
  const wrapper = spawn(process.execPath, ['-e', `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(payload)}],{stdio:['ignore','inherit','inherit']});c.on('exit',()=>process.exit());`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const [output] = await once(wrapper.stdout, 'data');
  const child = JSON.parse(output.toString());
  let f;
  try {
    const recorded = await recordStartupListeners(stateFor(backend, { pid: wrapper.pid, port: child.port }));
    assert.equal(recorded.frontend.pid, wrapper.pid);
    assert.equal(recorded.frontend.listenerPid, child.pid);
    f = fixture(recorded);
    const result = f.run(['stop']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(alive(child.pid), false);
    assert.equal(alive(backend.pid), false);
  } finally {
    if (alive(child.pid)) process.kill(child.pid);
    if (alive(wrapper.pid)) wrapper.kill();
    await cleanup(backend);
    if (f) rmSync(f.root, { recursive: true, force: true });
  }
});
