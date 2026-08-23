import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [assetsRootArg, outputPathArg] = process.argv.slice(2);
const assetsRoot = resolve(assetsRootArg ?? 'release-assets');
const outputPath = resolve(outputPathArg ?? join(assetsRoot, 'latest.json'));
const releaseTag = process.env.GITHUB_REF_NAME;
const version = process.env.KALIO_RELEASE_VERSION;

if (!releaseTag || !version) {
  throw new Error('GITHUB_REF_NAME and KALIO_RELEASE_VERSION are required to create latest.json');
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

const files = await listFiles(assetsRoot);

function assetByName(predicate, label) {
  const path = files.find((candidate) => predicate(candidate.split(/[\\/]/).pop() ?? ''));
  if (!path) {
    throw new Error(`Missing signed updater asset: ${label}`);
  }
  return path;
}

async function platformEntry(predicate, label) {
  const artifactPath = assetByName(predicate, label);
  const artifactName = artifactPath.split(/[\\/]/).pop();
  if (!artifactName) {
    throw new Error(`Unable to determine updater asset name: ${artifactPath}`);
  }

  const signaturePath = files.find(
    (candidate) => (candidate.split(/[\\/]/).pop() ?? '') === `${artifactName}.sig`,
  );
  if (!signaturePath) {
    throw new Error(`Missing updater signature: ${artifactName}.sig`);
  }
  const signature = (await readFile(signaturePath, 'utf8')).trim();
  if (!signature) {
    throw new Error(`Empty updater signature: ${signaturePath}`);
  }

  return {
    url: `https://github.com/Radomiej/kalio-forever/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(artifactName)}`,
    signature,
  };
}

const manifest = {
  version,
  notes: 'See the GitHub release notes for this version.',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': await platformEntry(
      (name) => name.endsWith('-setup.exe') && !name.endsWith('.sig'),
      'Windows NSIS installer',
    ),
    'linux-x86_64': await platformEntry(
      (name) => name.endsWith('.AppImage') && !name.endsWith('.sig'),
      'Linux AppImage',
    ),
  },
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`[desktop] wrote updater manifest to ${outputPath}`);
