import { createHash, createPrivateKey, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function versionFromTag(tag) {
  const normalized = String(tag ?? '').replace(/^v/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new Error('Invalid release version: ' + normalized);
  }
  return normalized;
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function parseRuntimeAsset(name, version) {
  const windowsSuffix = '-windows-x64.zip';
  const linuxSuffix = '-linux-x64.tar.gz';
  const suffix = name.endsWith(windowsSuffix)
    ? { platform: 'windows', suffix: windowsSuffix }
    : name.endsWith(linuxSuffix)
      ? { platform: 'linux', suffix: linuxSuffix }
      : null;
  if (!suffix || !name.startsWith('kalio-runtime-')) {
    return null;
  }
  const runtimePart = name.slice('kalio-runtime-'.length, -suffix.suffix.length);
  if (runtimePart !== version && runtimePart !== version + '-bun') {
    return null;
  }
  const runtime = runtimePart.endsWith('-bun') ? 'bun' : runtimePart === version ? 'node' : null;
  if (!runtime) {
    return null;
  }
  return {
    architecture: 'x64',
    name,
    platform: suffix.platform,
    runtime,
  };
}

export async function createRuntimeManifest(directory, tag, privateKeyText = '') {
  const version = versionFromTag(tag);
  const assets = [];
  for (const path of await collectFiles(directory)) {
    const name = path.slice(directory.length + 1).replaceAll('\\', '/');
    const fileName = name.split('/').at(-1);
    const parsed = parseRuntimeAsset(fileName, version);
    if (!parsed) {
      continue;
    }
    const fileStats = await stat(path);
    assets.push({
      ...parsed,
      name: fileName,
      sha256: await sha256(path),
      size: fileStats.size,
    });
  }
  assets.sort((left, right) => left.name.localeCompare(right.name));
  if (assets.length === 0) {
    throw new Error('No Kalio runtime archives were found in ' + directory);
  }
  const payloadObject = { schema: 1, tag, version, assets };
  const payloadJson = JSON.stringify(payloadObject);
  const manifest = {
    schema: 1,
    tag,
    version,
    payload: Buffer.from(payloadJson, 'utf8').toString('base64'),
  };
  if (privateKeyText.trim()) {
    const privateKey = createPrivateKey(privateKeyText);
    manifest.signatureAlgorithm = 'ed25519';
    manifest.signature = sign(null, Buffer.from(payloadJson, 'utf8'), privateKey).toString('base64');
  }
  return manifest;
}

async function main() {
  const directory = resolve(process.argv[2] ?? 'release-assets');
  const output = resolve(process.argv[3] ?? join(directory, 'kalio-runtime-manifest.json'));
  const tag = process.env.GITHUB_REF_NAME ?? process.env.KALIO_RELEASE_TAG ?? 'v' + (
    process.env.KALIO_RELEASE_VERSION ?? '1.0.0'
  );
  const manifest = await createRuntimeManifest(
    directory,
    tag,
    process.env.KALIO_RUNTIME_SIGNING_PRIVATE_KEY ?? '',
  );
  await writeFile(output, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  if (!manifest.signature) {
    console.warn('[kalio] WARNING: runtime manifest is unsigned; updater will warn and use SHA-256 unless signature enforcement is enabled');
  }
  console.log('[kalio] runtime manifest created: ' + output);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    await main();
  } catch (error) {
    console.error('[kalio] runtime manifest failed: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
