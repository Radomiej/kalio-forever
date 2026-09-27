import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCodexSpawnSpec, spawnCodexProcess } from './codex-app-server-process';

type SpawnSpec = ReturnType<typeof buildCodexSpawnSpec>;

function runSpec(
  spec: SpawnSpec,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnCodexProcess(spec.command, spec.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    if (!child.stdout || !child.stderr) {
      reject(new Error('Codex command shim must expose stdout and stderr pipes.'));
      return;
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const windowsTest = process.platform === 'win32' ? it : it.skip;

describe('Windows Codex command shims', () => {
  windowsTest('preserves adversarial argv for real .cmd and .bat launchers without shell execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kalio-cmd-integration-'));
    try {
      const probePath = join(root, 'record-argv.js');
      const shimBody = '@echo off\r\n"%NODE_EXE%" "%ARGV_PROBE%" %*\r\n';
      await writeFile(
        probePath,
        "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
        'utf8',
      );

      const expectedArgs = [
        'quoted "text"',
        'percent %PATH%',
        'operators &|<>^()!',
        'trailing-backslashes ' + '\\\\\\\\',
      ];

      for (const extension of ['cmd', 'bat']) {
        const shimPath = join(root, 'record arguments.' + extension);
        await writeFile(shimPath, shimBody, 'utf8');

        const spec = buildCodexSpawnSpec(shimPath, expectedArgs, 'win32');
        const result = await runSpec(spec, root, {
          ...process.env,
          NODE_EXE: process.execPath,
          ARGV_PROBE: probePath,
        });

        expect(result.code, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(expectedArgs);
        expect(existsSync(join(root, 'canary.txt'))).toBe(false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  windowsTest('rejects ambiguous quotes with shell metacharacters for CMD shims', () => {
    expect(() => buildCodexSpawnSpec(
      'codex.cmd',
      ['safe" & echo PWNED>canary.txt & rem "tail'],
      'win32',
    )).toThrow(/quotes with shell metacharacters/i);
  });

  windowsTest('rejects NUL and line breaks in CMD shim paths and arguments', () => {
    expect(() => buildCodexSpawnSpec('codex.cmd', ['safe\r\nmalicious'], 'win32'))
      .toThrow(/line breaks/i);
    expect(() => buildCodexSpawnSpec('codex.cmd\nmalicious', [], 'win32'))
      .toThrow(/line breaks/i);
    expect(() => buildCodexSpawnSpec('codex.cmd', ['safe\0malicious'], 'win32'))
      .toThrow(/NUL/i);
  });
});
