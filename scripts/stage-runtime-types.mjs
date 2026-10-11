import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Flat installs omit workspace dependencies; materialize the built package so
// Node resolves @kalio/types without the source checkout or pnpm links.
export async function stageRuntimeTypes(root, serverRoot) {
  const source = join(root, 'packages', '@kalio', 'types');
  const target = join(serverRoot, 'node_modules', '@kalio', 'types');
  await mkdir(target, { recursive: true });
  await cp(join(source, 'package.json'), join(target, 'package.json'));
  await cp(join(source, 'dist'), join(target, 'dist'), { recursive: true });
}
