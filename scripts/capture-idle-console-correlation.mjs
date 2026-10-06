import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseProcessCapture(stdout) {
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('Process capture contains no JSON snapshot');
  const snapshot = JSON.parse(stdout.slice(start));
  if (!snapshot || !Array.isArray(snapshot.starts) || !Number.isInteger(snapshot.samples)
    || snapshot.starts.some(row => !row || !Number.isInteger(row.pid) || !Number.isInteger(row.parentPid)
      || typeof row.name !== 'string')) throw new Error('Invalid process snapshot structure');
  return snapshot;
}

async function main() {

const root = fileURLToPath(new URL('../', import.meta.url));
const seconds = Number(process.argv[2] ?? 20);
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw new Error('Duration must be 1–60 seconds');

function capture(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts', script), '-Seconds', String(seconds)],
      { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${script} exited ${code}: ${stderr}`)));
  });
}

const [processes, windows] = await Promise.all([
  capture('measure-process-snapshots.ps1'), capture('watch-console-windows.ps1'),
]);
const directory = path.join(root, '.tmp', 'startup-captures');
await mkdir(directory, { recursive: true });
const artifact = path.join(directory, `idle-correlation-${Date.now()}.json`);
await writeFile(artifact, JSON.stringify({ processes, windows }, null, 2));
const snapshot = parseProcessCapture(processes.stdout);
const byPid = new Map(snapshot.starts.map(row => [row.pid, row]));
const events = windows.stdout.split(/\r?\n/).filter(line => /event=\d+/.test(line)).map(line => {
  const pid = Number(line.match(/\bpid=(\d+)/)?.[1] ?? 0);
  const process = byPid.get(pid);
  return { event: line, sampledProcess: process ?? null };
});
console.log(JSON.stringify({ artifact, samples: snapshot.samples, maxSampleGapMs: snapshot.maxSampleGapMs,
  startedAtUtc: snapshot.startedAtUtc, endedAtUtc: snapshot.endedAtUtc,
  processCount: snapshot.starts.length, events,
  boundary: 'Unknown window class does not prove visibility. Missing sample is not absence; baseline PIDs and PID reuse remain unresolved.' }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
