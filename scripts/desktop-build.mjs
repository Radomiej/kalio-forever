import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const desktopBackendOrigin = 'http://127.0.0.1:4516';

function run(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32' && command.endsWith('.cmd'),
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

const buildEnv = {
  ...process.env,
  VITE_API_URL: desktopBackendOrigin,
  VITE_WS_URL: desktopBackendOrigin,
};
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

console.log('[desktop] building API and web bundles');
await run(pnpm, ['build'], buildEnv);

console.log('[desktop] building Tauri Windows installer');
await run(process.execPath, [
  resolve(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
  'build',
  '--no-sign',
], buildEnv);
