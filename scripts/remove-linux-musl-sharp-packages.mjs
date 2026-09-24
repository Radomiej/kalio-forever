import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export async function removeLinuxMuslSharpPackages(nodeModulesRoot) {
  const imagePackageRoots = [
    join(nodeModulesRoot, '@img'),
    join(nodeModulesRoot, 'sharp', 'node_modules', '@img'),
  ];

  await Promise.all(imagePackageRoots.map(async (imagePackageRoot) => {
    let entries;
    try {
      entries = await readdir(imagePackageRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    const muslPackages = entries.filter(
      (entry) => (entry.isDirectory() || entry.isSymbolicLink()) && entry.name.includes('linuxmusl'),
    );
    await Promise.all(
      muslPackages.map((entry) => rm(join(imagePackageRoot, entry.name), { recursive: true, force: true })),
    );
  }));
}
