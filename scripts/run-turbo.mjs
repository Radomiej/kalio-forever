import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);

function quoteCmdArg(arg) {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function createWindowsPnpmShim() {
  const corepackCmd = resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'nodejs/corepack.cmd');
  if (!existsSync(corepackCmd)) {
    return undefined;
  }

  const shimDir = resolve(tmpdir(), 'kalio-pnpm-shim');
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(
    resolve(shimDir, 'pnpm.cmd'),
    `@echo off\r\ncall ${quoteCmdArg(corepackCmd)} pnpm %*\r\n`,
  );
  return shimDir;
}

const env = { ...process.env };
if (process.platform === 'win32') {
  const shimDir = createWindowsPnpmShim();
  const nodeDir = dirname(process.execPath);
  if (shimDir) {
    env.PATH = `${shimDir};${nodeDir};${env.PATH ?? ''}`;
  } else {
    env.PATH = `${nodeDir};${env.PATH ?? ''}`;
  }
  env.Path = env.PATH;
}

const turboBin = require.resolve('turbo/bin/turbo');
const child = spawn(process.execPath, [turboBin, ...args], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
});

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
