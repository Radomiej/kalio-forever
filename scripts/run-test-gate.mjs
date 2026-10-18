import { spawn } from 'node:child_process';
import { resolveCorepackEntrypoint } from './corepack-path.mjs';

const corepackEntrypoint = resolveCorepackEntrypoint();

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

const scriptTests = await run(process.execPath, [
  '--test',
  './scripts/stack-state.test.mjs',
  './scripts/corepack-path.test.mjs',
  './scripts/linux-installer.test.mjs',
  './scripts/linux-cli.test.mjs',
  './scripts/linux-updater.test.mjs',
  './scripts/local-model-benchmark.test.mjs',
  './scripts/runtime-dependencies.test.mjs',
  './scripts/kalio-updater.test.mjs',
  './scripts/runtime-scripts.test.mjs',
  './scripts/code-audit/audit-scripts.test.mjs',
  './scripts/agentflow-paid-readiness.test.mjs',
  './scripts/activate-live-credential.test.mjs',
]);

if (scriptTests.code !== 0) {
  process.exit(scriptTests.code);
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
  '--maxWorkers=2',
]);

if (appTests.code !== 0) {
  process.exit(appTests.code);
}

const preflight = await run(process.execPath, ['--test', './apps/e2e/scripts/start-playwright-stack.test.mjs']);
process.exit(preflight.code);
