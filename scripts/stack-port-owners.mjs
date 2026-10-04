import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

function runCommand(command, args) {
  return new Promise((accept, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
      (error, stdout) => {
        if (error && typeof error.code !== 'number') { reject(error); return; }
        accept({ code: error?.code ?? 0, stdout });
      });
  });
}

/** Fresh ownership snapshot for one lifecycle stage; never cached across stages. */
export async function resolveListeningPids(ports, { platform = process.platform, run = runCommand } = {}) {
  const requested = [...new Set(ports.filter(port => Number.isInteger(port) && port > 0 && port <= 65535))];
  const owners = new Map();
  if (requested.length === 0) return owners;

  if (platform === 'win32') {
    const result = await run(
      resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in @(${requested.join(',')}) } | ForEach-Object { "$($_.LocalPort):$($_.OwningProcess)" }`],
    );
    if (result.code !== 0) throw new Error('Listener ownership query failed');
    for (const line of result.stdout.trim().split(/\r?\n/).filter(Boolean)) {
      const match = /^(\d+):(\d+)$/.exec(line.trim());
      const port = Number(match?.[1]);
      const pid = Number(match?.[2]);
      if (!match || !requested.includes(port) || !Number.isSafeInteger(pid) || pid <= 0) {
        throw new Error('Invalid listener ownership response');
      }
      if (!owners.has(port)) owners.set(port, pid);
    }
    return owners;
  }

  for (const port of requested) {
    const result = await run('lsof', ['-tiTCP:' + String(port), '-sTCP:LISTEN']);
    if (result.code === 1 && result.stdout.trim() === '') continue;
    if (result.code !== 0) throw new Error('Listener ownership query failed');
    const line = result.stdout.trim().split(/\r?\n/)[0];
    if (!line) continue;
    const pid = Number(line);
    if (!/^\d+$/.test(line) || !Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error('Invalid listener ownership response');
    }
    owners.set(port, pid);
  }
  return owners;
}
