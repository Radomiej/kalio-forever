#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const jsonTargets = [
  'package.json',
  'apps/kalio-api/package.json',
  'apps/kalio-web/package.json',
  'apps/e2e/package.json',
  'apps/kalio-demo/package.json',
  'apps/kalio-video/package.json',
  'packages/@kalio/sdk/package.json',
  'packages/@kalio/types/package.json',
];

const textVersionRules = {
  'README.md': [
    /Kalio_(\d+\.\d+\.\d+)_x64-setup\.exe/g,
  ],
  'docs/desktop-build.md': [
    /Kalio_(\d+\.\d+\.\d+)_x64-setup\.exe/g,
    /v(\d+\.\d+\.\d+)(?=`)/g,
    /version `(\d+\.\d+\.\d+)`/g,
  ],
  'scripts/install.ps1': [
    /kalio-runtime-(\d+\.\d+\.\d+)-windows-x64\.zip/g,
  ],
};

const targetFiles = [
  ...jsonTargets,
  ...Object.keys(textVersionRules),
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json',
];

function replaceOnce(content, pattern, replacement, label) {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  if ((content.match(globalPattern) ?? []).length !== 1) {
    throw new Error(`Expected exactly one ${label} match`);
  }
  return content.replace(pattern, replacement);
}

function globalPattern(pattern) {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
}

function readVersion(path, content) {
  if (path.endsWith('.json')) {
    const value = JSON.parse(content).version;
    if (typeof value !== 'string') throw new Error(`${path} does not contain a string version`);
    return value;
  }
  const textRules = textVersionRules[path];
  if (textRules) {
    const versions = textRules.flatMap((pattern) => [...content.matchAll(globalPattern(pattern))].map((match) => match[1]));
    if (versions.length === 0) throw new Error(`${path} does not contain a release version reference`);
    const uniqueVersions = [...new Set(versions)];
    if (uniqueVersions.length !== 1) throw new Error(`${path} contains mismatched release versions: ${versions.join(', ')}`);
    return uniqueVersions[0];
  }
  const pattern = path.endsWith('Cargo.toml')
    ? /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m
    : /^\[\[package\]\]\r?\nname = "kalio"\r?\nversion = "([^"]+)"/m;
  const match = content.match(pattern);
  if (!match) throw new Error(`${path} Kalio package version is missing`);
  return match[1];
}

function updateVersion(path, content, version) {
  if (path.endsWith('.json')) {
    return replaceOnce(content, /(\"version\"\s*:\s*)\"[^\"]+\"/, `$1"${version}"`, `${path} version`);
  }
  const textRules = textVersionRules[path];
  if (textRules) {
    return textRules.reduce((updated, pattern) => {
      const versionPattern = globalPattern(pattern);
      if (!versionPattern.test(updated)) throw new Error(`Expected a ${path} release version match`);
      versionPattern.lastIndex = 0;
      return updated.replace(versionPattern, (match, currentVersion) => match.replace(currentVersion, version));
    }, content);
  }
  const pattern = path.endsWith('Cargo.toml')
    ? /^(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m
    : /^(\[\[package\]\]\r?\nname = "kalio"\r?\nversion = )"[^"]+"/m;
  return replaceOnce(content, pattern, `$1"${version}"`, `${path} version`);
}

const requested = process.argv[2];
if (process.argv.length !== 3 || (requested !== '--check' && !/^\d+\.\d+\.\d+$/.test(requested))) {
  throw new Error('Usage: pnpm release:version <MAJOR.MINOR.PATCH> | --check');
}

const entries = await Promise.all(targetFiles.map(async (path) => ({
  path,
  content: await readFile(join(root, path), 'utf8'),
})));
const versions = entries.map(({ path, content }) => readVersion(path, content));
const uniqueVersions = [...new Set(versions)];
if (uniqueVersions.length !== 1) {
  throw new Error(`Version files are out of sync: ${versions.join(', ')}`);
}

const current = uniqueVersions[0];
if (requested === '--check') {
  console.log(`Kalio version files are synchronized at ${current}`);
} else if (requested === current) {
  console.log(`Kalio version is already ${current}`);
} else {
  await Promise.all(entries.map(({ path, content }) => writeFile(join(root, path), updateVersion(path, content, requested), 'utf8')));
  console.log(`Updated Kalio version from ${current} to ${requested}`);
}
