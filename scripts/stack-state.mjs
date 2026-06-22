import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function resolveStackPaths(repoRoot) {
  const stackDir = resolve(repoRoot, '.tmp', 'qa-stack');
  const logsDir = resolve(repoRoot, '.tmp', 'qa-stack-logs');

  return {
    stackDir,
    logsDir,
    statePath: resolve(stackDir, 'qa-stack-state.json'),
    lastStatePath: resolve(stackDir, 'qa-stack-last-state.json'),
  };
}

export function readStackState(repoRoot, options = {}) {
  const paths = resolveStackPaths(repoRoot);
  const statePath = options.last === true ? paths.lastStatePath : paths.statePath;
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

export function stackApiUrlFromState(state) {
  const port = Number(state?.backendPort);
  return Number.isInteger(port) && port > 0 ? `http://127.0.0.1:${port}/api` : null;
}

export function readStackApiUrl(repoRoot) {
  return stackApiUrlFromState(readStackState(repoRoot));
}
