import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const cli = new URL('./kalio-cli.mjs', import.meta.url);

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'kalio-cli-lock-'));
  const root = join(home, 'app', 'versions', 'test');
  await mkdir(join(root, 'bin'), { recursive: true });
  await mkdir(join(root, 'server'));
  const runtimePath = join(root, 'bin', process.platform === 'win32' ? 'kalio-node.exe' : 'kalio-node');
  if (process.platform === 'win32') await copyFile(process.execPath, runtimePath);
  else await symlink(process.execPath, runtimePath);
  await writeFile(join(home, 'current.json'), JSON.stringify({ version: 'test' }));
  await writeFile(join(root, 'server', 'runtime-server-bootstrap.mjs'),
    "process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); console.log('READY');\n");
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

function launch(home, t) {
  const child = spawn(process.execPath, [cli.pathname, 'serve'], {
    env: { ...process.env, KALIO_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const finished = once(child, 'close').then(([code]) => ({ code, output }));
  t.after(async () => { child.stdin.end(); await finished; });
  const ready = new Promise(resolve => {
    child.stdout.on('data', () => { if (output.includes('READY')) resolve(true); });
    finished.then(() => resolve(false));
  });
  return { child, finished, ready };
}

async function deadPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'close');
  return child.pid;
}

test('runtime starts after its lock owner has exited', async t => {
  const home = await fixture(t);
  await writeFile(join(home, '.runtime.lock'), JSON.stringify({ pid: await deadPid() }));
  const runtime = launch(home, t);
  assert.equal(await runtime.ready, true);
  runtime.child.stdin.end();
  assert.equal((await runtime.finished).code, 0);
  await assert.rejects(readFile(join(home, '.runtime.lock')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(home, '.runtime.lock.recovery')), { code: 'ENOENT' });
});

test('runtime refuses a live owner without changing its lock', async t => {
  const home = await fixture(t);
  const lock = JSON.stringify({ pid: process.pid });
  await writeFile(join(home, '.runtime.lock'), lock);
  const runtime = launch(home, t);
  assert.equal(await runtime.ready, false);
  assert.equal((await runtime.finished).code, 1);
  assert.equal(await readFile(join(home, '.runtime.lock'), 'utf8'), lock);
});

test('runtime preserves malformed locks and explains manual recovery', async t => {
  const home = await fixture(t);
  await writeFile(join(home, '.runtime.lock'), 'not-json');
  const runtime = launch(home, t);
  const result = await runtime.finished;
  assert.equal(result.code, 1);
  assert.match(result.output, /cannot verify.*remove.*lock/i);
  assert.equal(await readFile(join(home, '.runtime.lock'), 'utf8'), 'not-json');
});

test('simultaneous stale-lock recovery starts exactly one runtime', async t => {
  const home = await fixture(t);
  await writeFile(join(home, '.runtime.lock'), JSON.stringify({ pid: await deadPid() }));
  const runtimes = Array.from({ length: 6 }, () => launch(home, t));
  const ready = await Promise.all(runtimes.map(runtime => runtime.ready));
  assert.equal(ready.filter(Boolean).length, 1);
  const winner = runtimes[ready.indexOf(true)];
  const owner = JSON.parse(await readFile(join(home, '.runtime.lock'), 'utf8'));
  assert.equal(owner.pid, winner.child.pid);
  winner.child.stdin.end();
  const results = await Promise.all(runtimes.map(runtime => runtime.finished));
  assert.equal(results.filter(result => result.code === 0).length, 1);
});

test('interrupted recovery remains fail-closed with an actionable diagnostic', async t => {
  const home = await fixture(t);
  const lock = JSON.stringify({ pid: await deadPid() });
  await writeFile(join(home, '.runtime.lock'), lock);
  await writeFile(join(home, '.runtime.lock.recovery'), 'interrupted');
  const runtime = launch(home, t);
  const result = await runtime.finished;
  assert.equal(result.code, 1);
  assert.match(result.output, /confirm Kalio is stopped before removing.*runtime.lock.recovery/);
  assert.equal(await readFile(join(home, '.runtime.lock'), 'utf8'), lock);
});
