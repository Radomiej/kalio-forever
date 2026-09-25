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
  ].join('\\n');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', workerCode], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KALIO_HOME: home,
      KALIO_CLI_URL: new URL('./kalio-cli.mjs', import.meta.url).href,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
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
      if (!started && stdout.includes('READY\\n')) {
        rejectReady(new Error('Worker closed before the start gate opened'));
      }
    });
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.includes('READY\\n')) resolveReady();
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', rejectReady);

  return {
    child,
    ready,
    exit,
    start() {
      if (started) return;
      started = true;
      child.stdin.write('go\\n');
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
    ].join('\\n'),
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
  if (workers.filter((worker) => worker.isClosed()).length >= target) return Promise.resolve(true);

  let count = workers.filter((worker) => worker.isClosed()).length;
  let timer;
  const reached = new Promise((resolve) => {
    for (const worker of workers) {
      worker.exit.then(() => {
        count += 1;
        if (count >= target) resolve(true);
      });
    }
  });
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  return Promise.race([reached, deadline]).finally(() => clearTimeout(timer));
}

async function releaseAndStop(workers, releasePath) {
  await writeFile(releasePath, 'release', 'utf8').catch(() => {});
  for (const worker of workers) worker.start();
  await Promise.all(workers.map((worker) => waitForExitCount([worker], 1, 5000)));
  for (const worker of workers) {
    if (!worker.isClosed()) worker.child.kill();
  }
  await Promise.all(workers.map((worker) => worker.exit));
}

test('runtime launcher fails closed on an orphaned reclaim lock and admits one stale-lock recovery winner', {
  timeout: 20_000,
}, async () => {
  const fixture = await createRuntimeFixture();
  const workers = [];
  const deadPid = await getDeadPid();

  try {
    await writeFile(
      fixture.lockPath,
      JSON.stringify({ pid: deadPid, startedAt: 'stale' }) + '\\n',
      'utf8',
    );
    await writeFile(fixture.reclaimPath, JSON.stringify({ pid: deadPid }) + '\\n', 'utf8');

    const orphanedReclaimWorker = startCliWorker(fixture.home);
    workers.push(orphanedReclaimWorker);
    await orphanedReclaimWorker.ready;
    orphanedReclaimWorker.start();

    const rejectedWithoutRelease = await waitForExitCount([orphanedReclaimWorker], 1, 1200);
    if (!rejectedWithoutRelease) await writeFile(fixture.releasePath, 'release', 'utf8');
    const orphanedResult = await orphanedReclaimWorker.exit;

    assert.equal(orphanedResult.code, 1, orphanedReclaimWorker.output());
    assert.equal(existsSync(fixture.startedPath), false, 'an orphaned reclaim mutex must fail closed');
    assert.equal(existsSync(fixture.lockPath), true, 'the stale primary lock must remain untouched');
    assert.equal(existsSync(fixture.reclaimPath), true, 'the unowned reclaim mutex must remain untouched');

    await rm(fixture.releasePath, { force: true });
    await rm(fixture.reclaimPath, { force: true });
    await writeFile(fixture.startedPath, '', 'utf8');
    await writeFile(
      fixture.lockPath,
      JSON.stringify({ pid: deadPid, startedAt: 'stale' }) + '\\n',
      'utf8',
    );

    const contenders = Array.from({ length: 8 }, () => startCliWorker(fixture.home));
    workers.push(...contenders);
    await Promise.all(contenders.map((worker) => worker.ready));
    for (const worker of contenders) worker.start();

    const oneWorkerRemainedLive = await waitForExitCount(contenders, contenders.length - 1, 3500);
    await writeFile(fixture.releasePath, 'release', 'utf8');
    await Promise.all(contenders.map((worker) => worker.exit));

    const startedCount = (await readFile(fixture.startedPath, 'utf8'))
      .split(/\\r?\\n/)
      .filter(Boolean)
      .length;

    assert.equal(oneWorkerRemainedLive, true, 'all but the one runtime owner should reject the lock');
    assert.equal(startedCount, 1, 'only one launcher may start the runtime during stale-lock recovery');
    assert.equal(existsSync(fixture.lockPath), false, 'the winner should release its own primary lock');
    assert.equal(existsSync(fixture.reclaimPath), false, 'the reclaim mutex should be removed after recovery');
  } finally {
    await releaseAndStop(workers, fixture.releasePath);
    await rm(fixture.root, { recursive: true, force: true });
  }
});
