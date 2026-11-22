import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Resolve missing descendants through their existing parent to catch junction escapes. */
export function assertSandboxPath(root: string, target: string): string {
  const canonicalRoot = realpathSync(root);
  const missing: string[] = [];
  let parent = resolve(target);
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent) throw new Error('ACCESS_DENIED: path is outside session sandbox');
    missing.unshift(basename(parent));
    parent = next;
  }
  const canonical = resolve(realpathSync(parent), ...missing);
  const offset = relative(canonicalRoot, canonical);
  if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new Error('ACCESS_DENIED: path is outside session sandbox');
  }
  return canonical;
}
