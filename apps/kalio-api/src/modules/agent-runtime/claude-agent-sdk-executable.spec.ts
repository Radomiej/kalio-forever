import { describe, expect, it } from 'vitest';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractClaudeAgentSdkExecutable } from './claude-agent-sdk-executable';

const gzipAsync = promisify(gzip);

describe('Claude Agent SDK executable extraction', () => {
  it('extracts the compressed Linux executable and reuses the cached path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kalio-claude-executable-'));
    const packageDirectory = join(root, 'package');
    const cacheDirectory = join(root, 'cache');
    const payload = Buffer.from('fake-linux-claude-executable');

    try {
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(join(packageDirectory, 'claude.gz'), await gzipAsync(payload));

      const executablePath = await extractClaudeAgentSdkExecutable(packageDirectory, '0.3.test', cacheDirectory);
      expect(await readFile(executablePath)).toEqual(payload);
      expect((await stat(executablePath)).isFile()).toBe(true);
      await expect(
        extractClaudeAgentSdkExecutable(packageDirectory, '0.3.test', cacheDirectory),
      ).resolves.toBe(executablePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a corrupt compressed executable instead of creating a partial binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kalio-claude-executable-'));
    const packageDirectory = join(root, 'package');

    try {
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(join(packageDirectory, 'claude.gz'), 'not gzip data');

      await expect(
        extractClaudeAgentSdkExecutable(packageDirectory, '0.3.invalid', join(root, 'cache')),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
