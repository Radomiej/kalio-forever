import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function resolveCorepackEntrypoint(nodeExecutable = process.execPath, programFiles = process.env.ProgramFiles) {
  const nodeDir = dirname(nodeExecutable);
  const candidates = [
    ...(programFiles ? [resolve(programFiles, 'nodejs/node_modules/corepack/dist/corepack.js')] : []),
    resolve(nodeDir, 'node_modules/corepack/dist/corepack.js'),
    resolve(nodeDir, '../lib/node_modules/corepack/dist/corepack.js'),
    resolve(nodeDir, '../node_modules/corepack/dist/corepack.js'),
  ];
  const entrypoint = candidates.find((candidate) => existsSync(candidate));
  if (!entrypoint) throw new Error('Corepack entrypoint not found. Install Corepack alongside Node.js.');
  return entrypoint;
}
