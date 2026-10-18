import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('Linux CLI forwards SIGTERM, waits for the server, and releases its runtime lock', { skip: process.platform !== 'linux', timeout: 10000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'kalio-cli-signal-'));
  const version = join(home, 'app/versions/1.2.3');
  mkdirSync(join(version, 'bin'), { recursive: true });
  mkdirSync(join(version, 'server'), { recursive: true });
  writeFileSync(join(home, 'current.json'), JSON.stringify({ version: '1.2.3', runtime: 'node' }));
  symlinkSync(process.execPath, join(version, 'bin/kalio-node'));
  const stopped = join(home, 'server-stopped');
  writeFileSync(join(version, 'server/runtime-server-bootstrap.mjs'), `
import {writeFileSync} from 'node:fs';
process.on('SIGTERM',()=>{writeFileSync(${JSON.stringify(stopped)},'stopped');process.exit(0)});
console.log(process.pid);
setInterval(()=>{},1000);
`);
  const cli = spawn(process.execPath, [resolve('scripts/kalio-cli.mjs'), 'serve'], {
    env: { ...process.env, KALIO_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverPid;
  t.after(() => {
    for (const pid of [cli.pid, serverPid]) {
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    }
    rmSync(home, { recursive: true, force: true });
  });
  const [chunk] = await once(cli.stdout, 'data');
  serverPid = Number(chunk.toString().trim());
  assert.ok(serverPid > 0);
  assert.equal(existsSync(join(home, '.runtime.lock')), true);
  const exit = once(cli, 'exit');
  cli.kill('SIGTERM');
  await exit;
  assert.equal(existsSync(stopped), true, 'server must receive the stop signal');
  assert.equal(existsSync(join(home, '.runtime.lock')), false, 'lock must be released after shutdown');
});
