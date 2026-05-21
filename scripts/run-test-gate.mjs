import { spawn } from 'node:child_process';

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
  './scripts/run-turbo.mjs',
  'run',
  'test',
  '--filter=@kalio/types',
  '--filter=@kalio/sdk',
  '--filter=kalio-api',
  '--filter=kalio-web',
]);

if (workspaceTests.code !== 0) {
  process.exit(workspaceTests.code);
}

const preflight = await run(process.execPath, ['--test', './apps/e2e/scripts/start-playwright-stack.test.mjs']);
process.exit(preflight.code);
