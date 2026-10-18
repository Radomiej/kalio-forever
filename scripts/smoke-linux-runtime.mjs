import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { openSync, closeSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const archive = arg('--archive');
if (process.platform !== 'linux' || !archive) throw new Error('Usage: node scripts/smoke-linux-runtime.mjs --archive <linux-runtime.tar.gz> [--output receipt.json] [--keep]');
const directory = await mkdtemp(join(tmpdir(), 'kalio-linux-runtime-'));
const home = join(directory, 'install with spaces');
const output = resolve(arg('--output', join(directory, 'receipt.json')));
const receipt = { archive: resolve(archive), home, startedAt: new Date().toISOString(), checks: [] };
let child;
let log;

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;

async function json(path, body) {
  const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function start() {
  child = spawn(join(home, 'bin/kalio'), ['serve'], { detached: true, env: { ...process.env, KALIO_PORT: String(port), EMBEDDING_PROVIDER: 'mock', KALIO_NO_OPEN: 'true' }, stdio: ['ignore', log, log] });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Runtime exited during startup: ${child.exitCode}`);
    try {
      const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error('Runtime health deadline exceeded');
}

async function stop() {
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  let timer;
  try {
    await Promise.race([stopped, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Runtime did not stop')), 8000); })]);
  } finally { clearTimeout(timer); }
  if (existsSync(join(home, '.runtime.lock'))) throw new Error('Runtime lock survived clean shutdown');
  child = undefined;
}

try {
  const installed = spawnSync('bash', [join(root, 'scripts/install.sh'), '--archive', resolve(archive), '--install-root', home, '--no-launch'], { encoding: 'utf8' });
  if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout);
  receipt.checks.push('install');
  log = openSync(join(home, 'logs/smoke.log'), 'a');
  await start();
  receipt.runtime = await json('/api/runtime/info');
  if (!receipt.runtime.embeddedUi || receipt.runtime.profile !== 'runtime') throw new Error('Wrong runtime profile or UI disabled');
  const page = await (await fetch(origin)).text();
  if (!page.includes('id="root"')) throw new Error('Embedded UI is missing');
  receipt.checks.push('health', 'runtime-info', 'embedded-ui');
  const session = await json('/api/sessions', { title: 'Linux installer smoke', personaId: 'default' });
  const files = {
    'index.mjs': 'export const sum = (a,b) => a+b;\n',
    'index.test.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import {sum} from './index.mjs'; test('addition including negatives',()=>{assert.equal(sum(2,3),5);assert.equal(sum(-2,3),1)});\n",
  };
  const project = join(directory, 'project');
  await mkdir(project);
  for (const [filePath, content] of Object.entries(files)) {
    await json(`/api/sessions/${session.id}/vfs`, { filePath, content });
    const persisted = await json(`/api/sessions/${session.id}/vfs/read?path=${encodeURIComponent(filePath)}`);
    if (persisted.content !== content) throw new Error('VFS file mismatch');
    await writeFile(join(project, filePath), persisted.content);
  }
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const tests = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'index.test.mjs'], { cwd: project, env, encoding: 'utf8' });
  if (tests.status !== 0 || !/# tests 1/.test(tests.stdout)) throw new Error(tests.stderr || tests.stdout || 'Project test did not execute');
  receipt.projectTests = tests.stdout;
  receipt.checks.push('session-create', 'vfs-write-read', 'node-project-tests');
  await stop();
  receipt.checks.push('clean-stop');
  await start();
  const persisted = await json(`/api/sessions/${session.id}/vfs/read?path=index.mjs`);
  if (persisted.content !== files['index.mjs']) throw new Error('Data did not survive restart');
  receipt.checks.push('restart-persistence');
  await stop();
  receipt.status = 'passed';
} catch (error) {
  receipt.status = 'failed';
  receipt.error = error.message;
  try { receipt.logTail = (await readFile(join(home, 'logs/smoke.log'), 'utf8')).slice(-6000); } catch (readError) { receipt.logReadError = readError.message; }
  process.exitCode = 1;
} finally {
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') console.error(error.message); }
  }
  if (log !== undefined) closeSync(log);
  receipt.completedAt = new Date().toISOString();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
  if (!args.includes('--keep') && !output.startsWith(directory + '/')) await rm(directory, { recursive: true, force: true });
}
