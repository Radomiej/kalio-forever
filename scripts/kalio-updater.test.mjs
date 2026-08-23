import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isVersionNewer,
  isRuntimeProcessOwned,
  verifyUpdateSignature,
} from './kalio-updater.mjs';
import { createRuntimeManifest } from './generate-runtime-release-manifest.mjs';

test('updater compares release versions without treating an equal version as newer', () => {
  assert.equal(isVersionNewer('1.1.0', '1.0.0'), true);
  assert.equal(isVersionNewer('1.0.0', '1.0.0'), false);
  assert.equal(isVersionNewer('0.9.0', '1.0.0'), false);
});

test('force-stop ownership rejects a stale PID reused by another application', () => {
  const home = String.raw`E:\Kalio`;
  assert.equal(
    isRuntimeProcessOwned(home, {
      ExecutablePath: String.raw`E:\Kalio\app\versions\1.0.0\bin\kalio-node.exe`,
      CommandLine: String.raw`"E:\Kalio\app\versions\1.0.0\bin\kalio-node.exe" E:\Kalio\app\versions\1.0.0\bin\kalio-cli.mjs serve`,
    }),
    true,
  );
  assert.equal(
    isRuntimeProcessOwned(home, {
      ExecutablePath: String.raw`C:\Program Files\nodejs\node.exe`,
      CommandLine: String.raw`"C:\Program Files\nodejs\node.exe" E:\Projekty\portal-muza\apps\web\.next\dev\server.js`,
    }),
    false,
  );
});

test('runtime manifest signs and verifies its exact payload with Ed25519', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kalio-updater-manifest-'));
  try {
    await writeFile(join(directory, 'kalio-runtime-1.0.0-windows-x64.zip'), 'node-runtime-fixture');
    await writeFile(join(directory, 'kalio-runtime-1.0.0-bun-windows-x64.zip'), 'bun-runtime-fixture');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const { publicKey: otherPublicKey } = generateKeyPairSync('ed25519');
    const manifest = await createRuntimeManifest(
      directory,
      'v1.0.0',
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    assert.equal(manifest.signatureAlgorithm, 'ed25519');
    assert.equal(verifyUpdateSignature(manifest, publicKeyPem), true);
    assert.equal(
      verifyUpdateSignature(
        manifest,
        otherPublicKey.export({ type: 'spki', format: 'pem' }).toString(),
      ),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
