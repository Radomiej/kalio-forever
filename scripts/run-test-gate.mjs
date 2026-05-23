import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const nodeDir = dirname(process.execPath);
const programFilesNodeDir = resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'nodejs');
const corepackEntrypoint = existsSync(resolve(programFilesNodeDir, 'node_modules/corepack/dist/corepack.js'))
  ? resolve(programFilesNodeDir, 'node_modules/corepack/dist/corepack.js')
  : resolve(nodeDir, 'node_modules/corepack/dist/corepack.js');

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      ...options,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolvePromise({ code: code ?? (signal ? 1 : 0), signal });
    });
  });
}

const workspaceTests = await run(process.execPath, [
  corepackEntrypoint,
  'pnpm',
  '-r',
  '--filter=@kalio/types',
  '--filter=@kalio/sdk',
  'run',
  'build',
]);

if (workspaceTests.code !== 0) {
  process.exit(workspaceTests.code);
}

const repoPreflight = await run(process.execPath, ['./scripts/repo-preflight.mjs']);

if (repoPreflight.code !== 0) {
  process.exit(repoPreflight.code);
}

const appTests = await run(process.execPath, [
  corepackEntrypoint,
  'pnpm',
  '-r',
  '--filter=@kalio/types',
  '--filter=kalio-api',
  '--filter=kalio-web',
  'run',
  'test',
]);

if (appTests.code !== 0) {
  process.exit(appTests.code);
}

const preflight = await run(process.execPath, ['--test', './apps/e2e/scripts/start-playwright-stack.test.mjs']);
process.exit(preflight.code);
