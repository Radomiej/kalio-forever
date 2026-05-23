import { rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const paths = process.argv.slice(2);
const scriptDir = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(scriptDir, '..');
const repoRootComparable = process.platform === 'win32' ? repoRoot.toLowerCase() : repoRoot;
const repoRootPrefix = `${repoRootComparable}${sep}`;

if (paths.length === 0) {
  console.error('[clean-paths] no paths provided');
  process.exit(1);
}

for (const targetPath of paths) {
  const absolutePath = resolve(process.cwd(), targetPath);
  const comparablePath = process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath;
  if (comparablePath === repoRootComparable || !comparablePath.startsWith(repoRootPrefix)) {
    throw new Error(`[clean-paths] refusing to remove outside repo: ${absolutePath}`);
  }
  rmSync(absolutePath, { recursive: true, force: true });
}
