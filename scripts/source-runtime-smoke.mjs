import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStackState } from './stack-state.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
assert.equal(readStackState(root), null, 'Smoke requires an isolated checkout with no managed stack');
const dataRoot = await mkdtemp(join(tmpdir(), 'kalio-source-smoke-'));
const envFile = join(dataRoot, 'smoke.env');
await writeFile(envFile, '');
const env = { ...process.env, CREDENTIALS_MASTER_KEY: randomBytes(32).toString('hex') };
function stack(args) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'scripts/stack-manager.mjs'), ...args], {
      cwd: root, env, stdio: 'inherit', windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? accept() : reject(new Error(`Stack ${args[0]} failed: ${code}`)));
  });
}
try {
  await stack(['start', '--profile', 'prod', '--backend-port', '0', '--frontend-port', '0',
    '--data-root', dataRoot, '--env-file', envFile,
    '--test-env-file', envFile, '--force-env-llm', '--provider', 'mock', '--model', 'mock']);
  const state = readStackState(root);
  assert.ok(state?.backendPort && state.frontendPort, 'Managed stack must publish allocated ports');
  const api = `http://127.0.0.1:${state.backendPort}`;
  const web = `http://127.0.0.1:${state.frontendPort}`;
  assert.equal((await fetch(`${api}/api/health`)).status, 200);
  const config = await (await fetch(`${api}/api/llm/config`)).json();
  assert.equal(config.provider, 'mock');
  assert.equal((await fetch(web)).status, 200);
  const runtimeConfig = await (await fetch(`${web}/runtime-config.js`)).text();
  assert.ok(runtimeConfig.includes(api), 'Browser API and socket origins must target the managed backend');
  console.log(`Source runtime smoke passed on ${process.platform}/${process.arch} with mock provider`);
} finally {
  if (readStackState(root)) await stack(['stop', '--profile', 'prod']);
}
