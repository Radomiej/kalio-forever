import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { ensureRequestedPortsAreFree, resolveListeningPids } from './stack-port-owners.mjs';

function processParents() {
  const windows = process.platform === 'win32';
  const command = windows
    ? resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
    : 'ps';
  const args = windows
    ? ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress']
    : ['-eo', 'pid=,ppid='];
  return new Promise((accept, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(error); return; }
      try {
        const pairs = windows
          ? JSON.parse(stdout).map(row => [row.ProcessId, row.ParentProcessId])
          : stdout.trim().split('\n').filter(Boolean).map(line => line.trim().split(/\s+/).map(Number));
        accept(new Map(pairs));
      } catch (parseError) { reject(parseError); }
    });
  });
}

function descendant(pid, ancestor, parents) {
  const visited = new Set();
  while (pid && !visited.has(pid)) {
    if (pid === ancestor) return true;
    visited.add(pid);
    pid = parents.get(pid);
  }
  return false;
}

/** Only called after this invocation started both children and observed readiness. */
export async function recordStartupListeners(state, { owners = resolveListeningPids, parents = processParents } = {}) {
  const observed = await owners([Number(state.backendPort), Number(state.frontendPort)]);
  let ancestry;
  const recorded = structuredClone(state);
  for (const role of ['backend', 'frontend']) {
    const listener = observed.get(Number(state[`${role}Port`]));
    const launcher = state[role]?.pid;
    if (!listener || !launcher) throw new Error(`[stack] ${role} startup listener ownership unknown; keeping state`);
    if (listener !== launcher) {
      ancestry ??= await parents();
      if (!descendant(listener, launcher, ancestry)) {
        throw new Error(`[stack] ${role} listener is not a child of its launcher; keeping state`);
      }
    }
    recorded[role].listenerPid = listener;
  }
  return recorded;
}

/** Validate both roles before returning any PID that a caller may terminate. */
export async function preflightStackStop(state, isAlive, { owners = resolveListeningPids, free = ensureRequestedPortsAreFree } = {}) {
  const observed = await owners([Number(state.backendPort), Number(state.frontendPort)]);
  const pids = new Set();
  for (const role of ['backend', 'frontend']) {
    const port = Number(state[`${role}Port`]);
    const expected = state[role]?.listenerPid ?? state[role]?.pid;
    if (!Number.isInteger(port) || port <= 0 || !Number.isSafeInteger(expected) || expected <= 0) {
      throw new Error(`[stack] ${role} ownership record missing; refusing to stop and keeping state`);
    }
    const actual = observed.get(port);
    if (actual !== undefined && actual !== expected) {
      throw new Error(`[stack] ${role} port ${port} belongs to pid ${actual}, expected ${expected}; refusing to stop and keeping state`);
    }
    if (actual === expected) { pids.add(expected); continue; }
    if (isAlive(expected)) throw new Error(`[stack] ${role} listener ownership unknown; refusing to stop and keeping state`);
    // An unavailable ownership utility must not make a live foreign port look free.
    await free([port]);
  }
  return [...pids];
}
