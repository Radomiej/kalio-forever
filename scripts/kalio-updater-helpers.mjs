import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

async function readJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Kalio-updater',
    },
  });
  if (!response.ok) {
    throw new Error(`Update metadata request failed with HTTP ${response.status}`);
  }
  return response.json();
}

function releaseApiUrl(options) {
  if (options.apiUrl) {
    return options.apiUrl.replace('{version}', options.version);
  }
  const base = `https://api.github.com/repos/${options.repository}/releases`;
  return options.version === 'latest'
    ? `${base}/latest`
    : `${base}/tags/${options.version.startsWith('v') ? options.version : `v${options.version}`}`;
}

function runtimeAssetName(version, runtime) {
  return `kalio-runtime-${version}${runtime === 'bun' ? '-bun' : ''}-windows-x64.zip`;
}

function parseVersion(version) {
  const match = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null;
}

export function isVersionNewer(candidate, current) {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);
  if (!candidateParts || !currentParts) {
    return candidate !== current;
  }
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
}

export async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Kalio-updater' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Update download failed with HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function findFile(directory, fileName) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const nested = await findFile(entryPath, fileName);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

async function readTrustedPublicKey(home, currentVersionRoot) {
  if (process.env.KALIO_RUNTIME_UPDATE_PUBLIC_KEY?.trim()) {
    return process.env.KALIO_RUNTIME_UPDATE_PUBLIC_KEY.trim();
  }
  const configuredPath = process.env.KALIO_RUNTIME_UPDATE_PUBLIC_KEY_FILE;
  const candidates = [
    configuredPath,
    join(currentVersionRoot, 'bin', 'runtime-update-public-key.pem'),
    join(home, 'runtime-update-public-key.pem'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return (await readFile(candidate, 'utf8')).trim();
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return '';
}

export function verifyUpdateSignature(manifest, publicKey) {
  if (!manifest.signature || !publicKey) {
    return false;
  }
  if (manifest.signatureAlgorithm !== 'ed25519') {
    throw new Error('Unsupported update signature algorithm');
  }
  if (typeof manifest.payload !== 'string') {
    throw new Error('Signed update manifest does not contain a payload');
  }
  const payload = Buffer.from(manifest.payload, 'base64');
  return verify(
    null,
    payload,
    createPublicKey(publicKey),
    Buffer.from(manifest.signature, 'base64'),
  );
}

export async function loadRelease(options, current, logMessage) {
  const release = await readJson(releaseApiUrl(options));
  if (release.draft || release.prerelease) {
    throw new Error('The selected GitHub Release is not a published stable release');
  }
  const releaseTag = String(release.tag_name ?? '');
  const releaseVersion = releaseTag.replace(/^v/, '');
  const runtime = options.runtime || current.current.runtime;
  const manifestAsset = release.assets?.find((asset) => asset.name === 'kalio-runtime-manifest.json');
  if (!manifestAsset) {
    throw new Error('kalio-runtime-manifest.json is missing from the published Release');
  }
  const manifestResponse = await fetch(manifestAsset.browser_download_url, {
    headers: { 'User-Agent': 'Kalio-updater' },
  });
  if (!manifestResponse.ok) {
    throw new Error(`Runtime manifest download failed with HTTP ${manifestResponse.status}`);
  }
  const manifest = await manifestResponse.json();
  if (manifest.schema !== 1 || typeof manifest.payload !== 'string') {
    throw new Error('Unsupported Kalio runtime manifest');
  }
  const payload = JSON.parse(Buffer.from(manifest.payload, 'base64').toString('utf8'));
  if (payload.version !== releaseVersion || payload.tag !== releaseTag) {
    throw new Error('Runtime manifest does not match its GitHub Release');
  }
  const trustedPublicKey = await readTrustedPublicKey(options.home, current.versionRoot);
  if (manifest.signature) {
    if (!trustedPublicKey) {
      if (!options.allowUnsigned) {
        throw new Error('Release is signed but no trusted Kalio update public key is installed');
      }
      await logMessage(options.home, 'WARNING: signature present but trusted public key is missing; using SHA-256 only');
    } else if (!verifyUpdateSignature(manifest, trustedPublicKey)) {
      throw new Error('Kalio runtime manifest signature verification failed');
    }
  } else if (!options.allowUnsigned) {
    throw new Error('Release has no Ed25519 signature; set --allow-unsigned only for a deliberate unsigned test release');
  } else {
    await logMessage(options.home, 'WARNING: Release has no Ed25519 signature; using HTTPS and SHA-256 only');
  }
  const expectedName = runtimeAssetName(releaseVersion, runtime);
  const target = payload.assets?.find((asset) => (
    asset.name === expectedName
      && asset.runtime === runtime
      && asset.platform === 'windows'
      && asset.architecture === 'x64'
  ));
  const releaseAsset = release.assets?.find((asset) => asset.name === expectedName);
  if (!target || !releaseAsset || !/^[a-f0-9]{64}$/i.test(String(target.sha256))) {
    throw new Error(`Runtime asset or SHA-256 entry is missing for ${expectedName}`);
  }
  return {
    asset: releaseAsset,
    expectedSha256: String(target.sha256).toLowerCase(),
    releaseTag,
    releaseVersion,
    runtime,
  };
}
