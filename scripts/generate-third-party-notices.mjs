import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoots = [
  join(root, 'node_modules', '.pnpm'),
  join(root, 'node_modules'),
  join(root, 'src-tauri', 'resources', 'kalio-server', 'node_modules'),
];
const output = getOutputPath(process.argv.slice(2));

function getOutputPath(args) {
  const outputIndex = args.indexOf('--output');
  if (outputIndex === -1) {
    return join(root, 'release', 'THIRD_PARTY_NOTICES.md');
  }

  const value = args[outputIndex + 1];
  if (!value) {
    throw new Error('--output requires a file path');
  }

  return resolve(root, value);
}

async function readDirectoryIfPresent(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function readManifest(manifestPath) {
  try {
    const contents = await readFile(manifestPath, 'utf8');
    return { manifest: JSON.parse(contents), packageDir: dirname(manifestPath) };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Unable to read ${manifestPath}: ${error.message}`);
  }
}

async function collectImmediatePackages(modulesRoot) {
  const packages = [];
  const entries = await readDirectoryIfPresent(modulesRoot);

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    if (entry.name.startsWith('@')) {
      const scopedEntries = await readDirectoryIfPresent(join(modulesRoot, entry.name));
      for (const scopedEntry of scopedEntries) {
        if (scopedEntry.name.startsWith('.')) {
          continue;
        }
        packages.push(join(modulesRoot, entry.name, scopedEntry.name, 'package.json'));
      }
      continue;
    }

    packages.push(join(modulesRoot, entry.name, 'package.json'));
  }

  return packages;
}

async function collectManifestPaths() {
  const paths = new Set();

  for (const packageRoot of packageRoots) {
    if (packageRoot.endsWith(`${join('node_modules', '.pnpm')}`)) {
      const entries = await readDirectoryIfPresent(packageRoot);
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }
        const nestedRoot = join(packageRoot, entry.name, 'node_modules');
        for (const manifestPath of await collectImmediatePackages(nestedRoot)) {
          paths.add(manifestPath);
        }
      }
      continue;
    }

    for (const manifestPath of await collectImmediatePackages(packageRoot)) {
      paths.add(manifestPath);
    }
  }

  return [...paths];
}

function normalizeLicense(manifest) {
  if (typeof manifest.license === 'string' && manifest.license.trim()) {
    return manifest.license.trim();
  }

  if (manifest.license && typeof manifest.license.type === 'string') {
    return manifest.license.type.trim();
  }

  return 'UNKNOWN';
}

function normalizeRepository(repository) {
  if (typeof repository === 'string') {
    return repository;
  }

  if (repository && typeof repository.url === 'string') {
    return repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
  }

  return '';
}

async function readLicenseFiles(packageDir) {
  const entries = await readDirectoryIfPresent(packageDir);
  const licenseEntries = entries
    .filter((entry) => entry.isFile() && /^(license|licence|copying|notice)(\..*)?$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const files = [];

  for (const entry of licenseEntries) {
    const path = join(packageDir, entry.name);
    const contents = await readFile(path, 'utf8');
    if (contents.includes('\u0000')) {
      continue;
    }
    files.push({ name: entry.name, contents: contents.trim() });
  }

  return files;
}

async function collectPackages() {
  const packages = new Map();

  for (const manifestPath of await collectManifestPaths()) {
    const result = await readManifest(manifestPath);
    if (!result || typeof result.manifest.name !== 'string' || typeof result.manifest.version !== 'string') {
      continue;
    }

    const name = result.manifest.name;
    if (name === 'kalio-forever' || name.startsWith('@kalio/')) {
      continue;
    }

    const key = `${name}@${result.manifest.version}`;
    if (packages.has(key)) {
      continue;
    }

    packages.set(key, {
      name,
      version: result.manifest.version,
      license: normalizeLicense(result.manifest),
      repository: normalizeRepository(result.manifest.repository),
      homepage: typeof result.manifest.homepage === 'string' ? result.manifest.homepage : '',
      licenseFiles: await readLicenseFiles(result.packageDir),
    });
  }

  return [...packages.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
}

function markdownCell(value) {
  return value.replaceAll('|', '\\|').replaceAll('\r', '').replaceAll('\n', ' ');
}

function licenseTextKey(contents) {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

function buildDocument(packages) {
  const lines = [
    '# Third-party notices',
    '',
    'This file is generated by `scripts/generate-third-party-notices.mjs` from the installed package manifests and license files.',
    'It is attached to Kalio release artifacts so recipients can review the third-party components included in the build.',
    'Third-party terms remain applicable to their respective components and are not replaced by the Kalio license.',
    '',
    '## Package inventory',
    '',
    '| Package | Version | Declared license | Source |',
    '| --- | --- | --- | --- |',
  ];

  for (const packageInfo of packages) {
    const source = packageInfo.repository || packageInfo.homepage || '';
    lines.push(`| ${markdownCell(packageInfo.name)} | ${markdownCell(packageInfo.version)} | ${markdownCell(packageInfo.license)} | ${markdownCell(source)} |`);
  }

  const licenseTexts = new Map();
  for (const packageInfo of packages) {
    for (const licenseFile of packageInfo.licenseFiles) {
      const key = licenseTextKey(licenseFile.contents);
      const existing = licenseTexts.get(key) ?? { name: licenseFile.name, packages: [], contents: licenseFile.contents };
      existing.packages.push(`${packageInfo.name}@${packageInfo.version}`);
      licenseTexts.set(key, existing);
    }
  }

  lines.push('', '## License and notice texts', '');
  for (const entry of [...licenseTexts.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    const packageNames = entry.packages.sort().join(', ');
    lines.push(`### ${entry.name}`, '', `Used by: ${packageNames}`, '');
    lines.push(...entry.contents.split(/\r?\n/).map((line) => `    ${line}`), '');
  }

  if (packages.length === 0) {
    throw new Error('No third-party package manifests were found');
  }

  return `${lines.join('\n')}\n`;
}

const packages = await collectPackages();
await mkdir(dirname(output), { recursive: true });
await writeFile(output, buildDocument(packages), 'utf8');
console.log(`[third-party-notices] wrote ${packages.length} packages to ${output}`);
