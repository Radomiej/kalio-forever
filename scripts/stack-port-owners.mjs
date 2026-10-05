import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

function runCommand(command, args) {
  return new Promise((accept, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 10000, maxBuffer: 1048576 },
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
      resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/netstat.exe'),
      ['-ano', '-p', 'tcp'],
    );
    if (result.code !== 0) throw new Error('Listener ownership query failed');
    const lines = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    // The title and column labels may be localized; protocol identifiers are not.
    if (lines.length > 1 && /^Proto\s/i.test(lines[1])) lines.shift();
    if (/^Proto\s/i.test(lines[0] ?? '')) lines.shift();
    for (const line of lines) {
      const match = /^TCP\s+\S+:(\d+)\s+\S+:\d+\s+(\S+)\s+(\d+)$/.exec(line);
      const port = Number(match?.[1]);
      const pid = Number(match?.[3]);
      if (!match || port < 0 || port > 65535 || !Number.isSafeInteger(pid) || pid < 0) {
        throw new Error('Invalid listener ownership response');
      }
      if (match[2] !== 'LISTENING' || !requested.includes(port)) continue;
      if (pid === 0 || (owners.has(port) && owners.get(port) !== pid)) {
        throw new Error('Ambiguous listener ownership response');
      }
      owners.set(port, pid);
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
