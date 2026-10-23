import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// One diagnostic launcher prevents parallel agent commands contaminating capture.
// No database reset, build, command-line capture, or visible helper consoles.
const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
const captureSeconds = 90;
function launch(command, args, readyText) {
  const child = spawn(command, args, {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let stdout = '';
  let stderr = '';
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (readyText && stdout.includes(readyText)) readyResolve();
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { readyReject(error); reject(error); });
    child.once('close', code => {
      children.delete(child);
      if (readyText && !stdout.includes(readyText)) readyReject(new Error(stderr || 'Monitor exited before ready'));
      resolve({ pid: child.pid, code, stdout, stderr });
    });
  });
  // Attach immediately, including failures before the readiness barrier.
  done.catch(error => { console.error(error.message); });
  return { ready, done };
}

if (process.platform !== 'win32') throw new Error('Windows diagnostic only');
const qaDataRoot = process.env.KALIO_QA_DATA_ROOT
  ?? `${process.env.LOCALAPPDATA}/kalio-forever-qa`;
const timer = setTimeout(() => {
  console.error('Diagnostic timeout: capture incomplete');
  for (const child of children) child.kill();
}, (captureSeconds + 30) * 1000);
try {
  const windowMonitor = launch('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
    '-File', 'scripts/watch-console-windows.ps1', '-Seconds', String(captureSeconds)], 'WINDOW_EVENT_HOOK_READY');
  const processMonitor = launch('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
    '-File', 'scripts/measure-process-snapshots.ps1', '-Seconds', String(captureSeconds)], 'PROCESS_SNAPSHOT_READY');
  await Promise.all([windowMonitor.ready, processMonitor.ready]);
  console.log('QA_START_CAPTURE_READY utc=' + new Date().toISOString());
  const launcher = launch(process.execPath, ['scripts/stack-manager.mjs', 'start',
    '--skip-build', '--runtime', 'direct', '--backend-port', '3316', '--frontend-port', '5288',
    '--data-root', qaDataRoot]);
  const results = await Promise.all([launcher.done, windowMonitor.done, processMonitor.done]);
  const capture = results.map((result, index) => ({
    kind: ['qa-launcher', 'window-events', 'process-samples'][index], ...result,
  }));
  const outputDir = resolve(root, '.tmp', 'startup-captures');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `capture-${Date.now()}-${process.pid}.json`);
  writeFileSync(outputPath, JSON.stringify(capture, null, 2));
  console.log(JSON.stringify({ outputPath, results: capture.map(result => ({
    kind: result.kind, pid: result.pid, code: result.code,
    stdoutBytes: Buffer.byteLength(result.stdout), stderr: result.stderr,
  })) }));
  if (results.some(result => result.code !== 0)) process.exitCode = 1;
} finally {
  clearTimeout(timer);
  for (const child of children) child.kill();
}
