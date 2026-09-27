import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function startCliWorker(home) {
  const workerCode = [
    "process.stdout.write('READY\\n');",
    "await new Promise((resolve) => process.stdin.once('data', resolve));",
    "process.argv.splice(1, process.argv.length, 'scripts/kalio-cli.mjs', 'serve');",
    'await import(process.env.KALIO_CLI_URL);',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', workerCode], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KALIO_HOME: home,
      KALIO_CLI_URL: new URL('./kalio-cli.mjs', import.meta.url).href,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: true,
  });

  let stdout = '';
  let stderr = '';
  let closed = false;
  let started = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const exit = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      closed = true;
      resolve({ code, signal });
      if (!started) {
        rejectReady(new Error('Worker exited before the start gate opened: ' + JSON.stringify({ code, signal, stdout, stderr })));
      }
    });
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.includes('READY\n')) resolveReady();
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', rejectReady);

  return {
    child,
    ready,
    exit,
    start() {
      if (started || closed) return;
      started = true;
      child.stdin.write('go\n');
    },
    isClosed: () => closed,
    output: () => stdout + stderr,
  };
}

async function getDeadPid() {
  const child = spawn(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code }));
  });
  assert.equal(result.code, 0);
  const pid = Number(output);
  assert.ok(Number.isInteger(pid) && pid > 0);
  return pid;
}

async function createRuntimeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kalio-runtime-lock-'));
  const home = join(root, 'home');
  const versionRoot = join(home, 'app', 'versions', 'test');
  const serverRoot = join(versionRoot, 'server');
  const binRoot = join(versionRoot, 'bin');
  const runtimeName = process.platform === 'win32' ? 'kalio-node.exe' : 'kalio-node';
  const runtimePath = join(binRoot, runtimeName);
  const lockPath = join(home, '.runtime.lock');
  const reclaimPath = lockPath + '.reclaim';
  const startedPath = join(home, 'runtime-started.log');
  const releasePath = join(home, 'release-runtime');

  await mkdir(serverRoot, { recursive: true });
  await mkdir(binRoot, { recursive: true });
  await writeFile(join(home, 'current.json'), JSON.stringify({ version: 'test', runtime: 'node' }), 'utf8');
  await writeFile(
    join(serverRoot, 'runtime-server-bootstrap.mjs'),
    [
      "import { existsSync, watch } from 'node:fs';",
      "import { appendFile } from 'node:fs/promises';",
      "import { join } from 'node:path';",
      'const home = process.env.KALIO_HOME;',
      "await appendFile(join(home, 'runtime-started.log'), 'started\\n');",
      "const releasePath = join(home, 'release-runtime');",
      'await new Promise((resolve, reject) => {',
      '  let watcher;',
      '  const finish = () => { watcher?.close(); resolve(); };',
      '  watcher = watch(home, (_event, filename) => {',
      "    if (filename?.toString() === 'release-runtime') finish();",
      '  });',
      "  watcher.once('error', (error) => { watcher.close(); reject(error); });",
      '  if (existsSync(releasePath)) finish();',
      '});',
    ].join('\n'),
    'utf8',
  );

  try {
    await link(process.execPath, runtimePath);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'EXDEV'].includes(error?.code)) throw error;
    await copyFile(process.execPath, runtimePath);
  }

  return { root, home, lockPath, reclaimPath, startedPath, releasePath };
}

function waitForExitCount(workers, target, timeoutMs) {
  const closed = new Set(workers.filter((worker) => worker.isClosed()));
  if (closed.size >= target) return Promise.resolve(true);

  let timer;
  const reached = new Promise((resolve) => {
    for (const worker of workers) {
      if (closed.has(worker)) continue;
      worker.exit.then(() => {
        if (closed.has(worker)) return;
        closed.add(worker);
        if (closed.size >= target) resolve(true);
      });
    }
  });
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  return Promise.race([reached, deadline]).finally(() => clearTimeout(timer));
}

async function terminateWorkerTree(worker) {
  const pid = worker.child.pid;
  if (!pid || worker.isClosed()) return;

  if (process.platform === 'win32') {
    const code = await new Promise((resolve, reject) => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', reject);
      killer.once('close', resolve);
    });
    if (code !== 0 && !worker.isClosed()) {
      throw new Error('Unable to stop runtime-lock worker tree for PID ' + pid);
    }
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function releaseAndStop(workers, releasePath) {
  await writeFile(releasePath, 'release', 'utf8');
  for (const worker of workers) worker.start();

  if (await waitForExitCount(workers, workers.length, 1500)) return;

  await Promise.all(workers.map(terminateWorkerTree));
  const allWorkersStopped = await waitForExitCount(workers, workers.length, 3000);
  if (!allWorkersStopped) {
    throw new Error('Runtime-lock worker tree did not stop after cleanup.');
  }
}

test('runtime launcher admits exactly one stale-lock recovery winner', {
  timeout: 20_000,
}, async () => {
  const fixture = await createRuntimeFixture();
  const contenders = [];
  const deadPid = await getDeadPid();

  try {
    await writeFile(
      fixture.lockPath,
      JSON.stringify({ pid: deadPid, startedAt: 'stale' }) + '\n',
      'utf8',
    );

    contenders.push(...Array.from({ length: 8 }, () => startCliWorker(fixture.home)));
    await Promise.all(contenders.map((worker) => worker.ready));
    for (const worker of contenders) worker.start();

    const oneWorkerRemainedLive = await waitForExitCount(contenders, contenders.length - 1, 3500);
    await writeFile(fixture.releasePath, 'release', 'utf8');
    const allWorkersExited = await waitForExitCount(contenders, contenders.length, 5000);

    const startedCount = existsSync(fixture.startedPath)
      ? (await readFile(fixture.startedPath, 'utf8')).split(/\r?\n/).filter(Boolean).length
      : 0;

    assert.equal(oneWorkerRemainedLive, true, 'all but the one runtime owner should reject the lock');
    assert.equal(allWorkersExited, true, 'all launchers should exit after the runtime is released');
    assert.equal(startedCount, 1, 'only one launcher may start the runtime during stale-lock recovery');
    assert.equal(existsSync(fixture.lockPath), false, 'the winner should release its own primary lock');
    assert.equal(existsSync(fixture.reclaimPath), false, 'the reclaim mutex should be removed after recovery');
  } finally {
    await releaseAndStop(contenders, fixture.releasePath);
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('runtime launcher fails closed on an orphaned reclaim lock', {
  timeout: 20_000,
}, async () => {
  const fixture = await createRuntimeFixture();
  const deadPid = await getDeadPid();
  const worker = startCliWorker(fixture.home);

  try {
    await writeFile(
      fixture.lockPath,
      JSON.stringify({ pid: deadPid, startedAt: 'stale' }) + '\n',
      'utf8',
    );
    await writeFile(fixture.reclaimPath, JSON.stringify({ pid: deadPid }) + '\n', 'utf8');

    await worker.ready;
    worker.start();

    const rejectedWithoutRelease = await waitForExitCount([worker], 1, 1200);
    if (!rejectedWithoutRelease) await writeFile(fixture.releasePath, 'release', 'utf8');
    const workerExited = await waitForExitCount([worker], 1, 5000);

    assert.equal(workerExited, true, 'the launcher should exit after rejection or runtime release');
    const result = await worker.exit;
    assert.equal(result.code, 1, worker.output());
    assert.equal(existsSync(fixture.startedPath), false, 'an orphaned reclaim mutex must fail closed');
    assert.equal(existsSync(fixture.lockPath), true, 'the stale primary lock must remain untouched');
    assert.equal(existsSync(fixture.reclaimPath), true, 'the unowned reclaim mutex must remain untouched');
  } finally {
    await releaseAndStop([worker], fixture.releasePath);
    await rm(fixture.root, { recursive: true, force: true });
  }
});
