import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

export async function compressClaudeAgentSdkExecutable(packageDirectory) {
  const executablePath = join(packageDirectory, 'claude');
  const compressedPath = join(packageDirectory, 'claude.gz');
  if (!await isRegularFile(executablePath)) {
    if (await isRegularFile(compressedPath)) {
      return;
    }
    throw new Error(`Claude Agent SDK executable is missing: ${executablePath}`);
  }

  const temporaryPath = `${compressedPath}.tmp-${process.pid}`;
  try {
    await pipeline(
      createReadStream(executablePath),
      createGzip({ level: 9 }),
      createWriteStream(temporaryPath, { flags: 'wx', mode: 0o644 }),
    );
    await chmod(temporaryPath, 0o644);
    await rename(temporaryPath, compressedPath);
    await rm(executablePath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
