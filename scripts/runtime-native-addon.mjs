import { cp, stat } from 'node:fs/promises';

/** pnpm may hardlink the workspace and staged native addon to the same cached file. */
export async function copyNativeAddon(source, target) {
  const sourceInfo = await stat(source, { bigint: true });
  let targetInfo;
  try { targetInfo = await stat(target, { bigint: true }); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (sourceInfo.ino !== 0n && sourceInfo.dev === targetInfo?.dev && sourceInfo.ino === targetInfo?.ino) return;
  await cp(source, target, { force: true });
}
