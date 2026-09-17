import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeManifest } from './generate-runtime-release-manifest.mjs';
import { loadRelease, verifyUpdateSignature } from './kalio-updater-helpers.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const expectedVersion = '1.0.2';
const workspaceManifestPaths = [
  'package.json',
  'apps/kalio-api/package.json',
  'apps/kalio-web/package.json',
  'apps/e2e/package.json',
  'apps/kalio-video/package.json',
  'apps/kalio-demo/package.json',
  'packages/@kalio/types/package.json',
  'packages/@kalio/sdk/package.json',
];

async function withTempDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'kalio-release-qa-'));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readRootFile(path) {
  return readFile(join(root, path), 'utf8');
}

test('v1.0.2 release surfaces stay synchronized across Node, Tauri, Rust, and docs', async () => {
  for (const path of workspaceManifestPaths) {
    const manifest = JSON.parse(await readRootFile(path));
    assert.equal(manifest.version, expectedVersion, `${path} has a mismatched release version`);
  }

  const tauriConfig = JSON.parse(await readRootFile('src-tauri/tauri.conf.json'));
  assert.equal(tauriConfig.version, expectedVersion);

  const cargoManifest = await readRootFile('src-tauri/Cargo.toml');
  assert.match(cargoManifest, new RegExp(`^version = "${expectedVersion.replaceAll('.', '\\.') }"$`, 'm'));

  const cargoLock = await readRootFile('src-tauri/Cargo.lock');
  const kalioLockEntry = cargoLock.match(/\[\[package\]\]\r?\nname = "kalio"\r?\nversion = "([^"]+)"/);
  assert.ok(kalioLockEntry, 'Kalio package is missing from Cargo.lock');
  assert.equal(kalioLockEntry[1], expectedVersion);

  assert.match(await readRootFile('README.md'), /Kalio_1\.0\.2_x64-setup\.exe/);
  assert.match(await readRootFile('docs/desktop-build.md'), /Kalio_1\.0\.2_x64-setup\.exe/);
  assert.match(await readRootFile('docs/desktop-build.md'), /v1\.0\.2.*version `1\.0\.2`/s);
  assert.match(await readRootFile('scripts/install.ps1'), /kalio-runtime-1\.0\.2-windows-x64\.zip/);
});

test('tagged desktop release is version-gated and unsigned Windows signing is explicit', async () => {
  const workflow = await readRootFile('.github/workflows/desktop-release.yml');
  const tauriPrepare = await readRootFile('scripts/tauri-prepare.mjs');
  const runtimePackage = await readRootFile('scripts/build-runtime-package.mjs');

  assert.match(workflow, /tags:\r?\n\s+- "v\*"/);
  assert.match(workflow, /release:\r?\n\s+if: startsWith\(github\.ref, 'refs\/tags\/'\)/);
  assert.match(workflow, /needs: \[build-windows, build-linux\]/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /\$tagVersion = \$env:GITHUB_REF_NAME\.TrimStart\('v'\)/);
  assert.match(workflow, /Release version mismatch/);
  assert.match(workflow, /Tauri updater signing is disabled; release will contain unsigned\/manual-update artifacts/);
  assert.match(workflow, /pnpm tauri build --no-sign/);
  assert.match(workflow, /Windows Authenticode signing is intentionally disabled/);
  assert.doesNotMatch(workflow, /WINDOWS_CERTIFICATE|CERTIFICATE_PASSWORD/);
  assert.match(tauriPrepare, /sharp[\s\S]*node_modules[\s\S]*@img[\s\S]*linuxmusl/);
  assert.match(runtimePackage, /sharp[\s\S]*node_modules[\s\S]*@img[\s\S]*linuxmusl/);
  assert.doesNotMatch(tauriPrepare, /entry\.isDirectory\(\)\s*&&\s*entry\.name\.includes\('linuxmusl'\)/);
  assert.doesNotMatch(runtimePackage, /entry\.isDirectory\(\)\s*&&\s*entry\.name\.includes\('linuxmusl'\)/);
});

test('runtime manifest includes only the tagged archives and detects payload tampering', async () => {
  await withTempDirectory(async (directory) => {
    const nestedDirectory = join(directory, 'nested');
    await mkdir(nestedDirectory);
    await writeFile(join(directory, 'kalio-runtime-1.0.2-windows-x64.zip'), 'node runtime');
    await writeFile(join(nestedDirectory, 'kalio-runtime-1.0.2-bun-windows-x64.zip'), 'bun runtime');
    await writeFile(join(directory, 'kalio-runtime-1.0.1-windows-x64.zip'), 'stale runtime');

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const manifest = await createRuntimeManifest(directory, `v${expectedVersion}`, privateKeyPem);
    const payload = JSON.parse(Buffer.from(manifest.payload, 'base64').toString('utf8'));
    const assetNames = payload.assets.map((asset) => asset.name);

    assert.deepEqual(assetNames, [
      'kalio-runtime-1.0.2-bun-windows-x64.zip',
      'kalio-runtime-1.0.2-windows-x64.zip',
    ]);
    assert.equal(payload.version, expectedVersion);
    assert.equal(
      payload.assets.find((asset) => asset.runtime === 'node').sha256,
      createHash('sha256').update('node runtime').digest('hex'),
    );
    assert.equal(verifyUpdateSignature(manifest, publicKeyPem), true);

    const tamperedPayload = {
      ...payload,
      version: '9.9.9',
    };
    const tamperedManifest = {
      ...manifest,
      payload: Buffer.from(JSON.stringify(tamperedPayload), 'utf8').toString('base64'),
    };
    assert.equal(verifyUpdateSignature(tamperedManifest, publicKeyPem), false);
  });
});

test('updater rejects draft and unsigned releases unless the unsigned path is explicit', async () => {
  await withTempDirectory(async (directory) => {
    const release = {
      draft: false,
      prerelease: false,
      tag_name: `v${expectedVersion}`,
      assets: [
        {
          name: 'kalio-runtime-manifest.json',
          browser_download_url: 'https://updates.test/manifest',
        },
        {
          name: `kalio-runtime-${expectedVersion}-windows-x64.zip`,
          browser_download_url: 'https://updates.test/runtime.zip',
        },
      ],
    };
    const payload = {
      schema: 1,
      tag: `v${expectedVersion}`,
      version: expectedVersion,
      assets: [{
        name: `kalio-runtime-${expectedVersion}-windows-x64.zip`,
        runtime: 'node',
        platform: 'windows',
        architecture: 'x64',
        sha256: 'a'.repeat(64),
        size: 12,
      }],
    };
    const manifest = {
      schema: 1,
      tag: `v${expectedVersion}`,
      version: expectedVersion,
      payload: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
    };
    const current = { current: { runtime: 'node' }, versionRoot: directory };
    const originalFetch = globalThis.fetch;
    let draft = true;

    try {
      globalThis.fetch = async (url) => {
        if (String(url).endsWith('/manifest')) {
          return { ok: true, json: async () => manifest };
        }
        return { ok: true, json: async () => (draft ? { ...release, draft: true } : release) };
      };

      const options = {
        apiUrl: 'https://updates.test/release/{version}',
        home: directory,
        runtime: 'node',
        version: 'latest',
      };
      await assert.rejects(
        loadRelease(options, current, async () => {}),
        /not a published stable release/,
      );

      draft = false;
      await assert.rejects(
        loadRelease(options, current, async () => {}),
        /no Ed25519 signature/,
      );

      const logs = [];
      const result = await loadRelease(
        { ...options, allowUnsigned: true },
        current,
        async (_home, message) => logs.push(message),
      );
      assert.equal(result.releaseVersion, expectedVersion);
      assert.equal(result.expectedSha256, 'a'.repeat(64));
      assert.match(logs[0], /WARNING: Release has no Ed25519 signature/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('desktop workflow passes updater secrets to Tauri and uses a compatible Linux runner', async () => {
  const workflow = await readRootFile('.github/workflows/desktop-release.yml');

  assert.match(workflow, /build-linux:\r?\n\s+runs-on: ubuntu-24\.04/);
  assert.match(workflow, /libfuse2t64/);

  const windowsBuild = workflow.match(
    /- name: Build Windows Tauri package with optional updater signature[\s\S]*?(?=\r?\n      - name: Smoke test installed Windows Tauri app)/,
  )?.[0];
  assert.ok(windowsBuild, 'signed Windows Tauri build step is missing');
  assert.match(windowsBuild, /env:\r?\n\s+TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
  assert.match(windowsBuild, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD \}\}/);

  const linuxBuild = workflow.match(
    /- name: Build Linux Tauri package with optional updater signature[\s\S]*?(?=\r?\n      - name: Smoke test packaged Linux backend)/,
  )?.[0];
  assert.ok(linuxBuild, 'signed Linux Tauri build step is missing');
  assert.match(linuxBuild, /env:\r?\n\s+TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
  assert.match(linuxBuild, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD \}\}/);
});
