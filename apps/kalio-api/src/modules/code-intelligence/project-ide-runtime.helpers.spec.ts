import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { isSupportedVersion, readVsCodeVersion } from './project-ide-runtime.helpers';

const temporaryRoots: string[] = [];

describe('bridge compatibility', () => {
  it.each(['0.4.7', '0.4.9', '0.5.3'])('accepts verified compatible release %s', version => {
    expect(isSupportedVersion(version)).toBe(true);
  });
  it.each(['0.4.6', '0.5.0', '0.5.4', '1.0.0', '0.5.3-beta', '0.5.3junk', '0.5', '0.4.7.1', '00.4.7', ' 0.5.3'])('rejects unverified or malformed release %s', version => {
    expect(isSupportedVersion(version)).toBe(false);
  });
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('readVsCodeVersion', () => {
  it('reads install metadata without launching Code.exe', () => {
    const root = mkdtempSync(join(tmpdir(), 'kalio-vscode-'));
    temporaryRoots.push(root);
    const appRoot = join(root, '034f571df5', 'resources', 'app');
    mkdirSync(appRoot, { recursive: true });
    writeFileSync(join(appRoot, 'product.json'), JSON.stringify({ version: '1.118.1' }));

    expect(readVsCodeVersion(join(root, 'Code.exe'))).toBe('1.118.1');
  });

  it('falls back to package metadata when product metadata is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'kalio-vscode-'));
    temporaryRoots.push(root);
    const appRoot = join(root, 'resources', 'app');
    mkdirSync(appRoot, { recursive: true });
    writeFileSync(join(appRoot, 'package.json'), JSON.stringify({ version: '1.117.0' }));

    expect(readVsCodeVersion(join(root, 'Code.exe'))).toBe('1.117.0');
  });
});
