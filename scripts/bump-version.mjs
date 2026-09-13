#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  ...[
    'package.json',
    'apps/kalio-api/package.json',
    'apps/kalio-web/package.json',
    'apps/e2e/package.json',
    'apps/kalio-demo/package.json',
    'apps/kalio-video/package.json',
    'packages/@kalio/sdk/package.json',
    'packages/@kalio/types/package.json',
  ].map(path => ({
    path,
    readVersion(content) {
      const value = JSON.parse(content).version;
      if (typeof value !== 'string') {
        throw new Error(path + ' does not contain a string version');
      }
      return value;
    },
    update(content, version) {
      return replaceOnce(
        content,
        /("version"\s*:\s*)"[^"]+"/,
        '$1"' + version + '"',
        path + ' version',
      );
    },
  })),
  {
    path: 'src-tauri/Cargo.toml',
    readVersion(content) {
      const match = content.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
      if (!match) {
        throw new Error('src-tauri/Cargo.toml package version is missing');
      }
      return match[1];
    },
    update(content, version) {
      return replaceOnce(
        content,
        /^(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
        '$1"' + version + '"',
        'src-tauri/Cargo.toml package version',
      );
    },
  },
  {
    path: 'src-tauri/Cargo.lock',
    readVersion(content) {
      const match = content.match(/^\[\[package\]\]\r?\nname = "kalio"\r?\nversion = "([^"]+)"/m);
      if (!match) {
        throw new Error('src-tauri/Cargo.lock kalio package version is missing');
      }
      return match[1];
    },
    update(content, version) {
      return replaceOnce(
        content,
        /^(\[\[package\]\]\r?\nname = "kalio"\r?\nversion = )"[^"]+"/m,
        '$1"' + version + '"',
        'src-tauri/Cargo.lock kalio package version',
      );
    },
  },
  {
    path: 'src-tauri/tauri.conf.json',
    readVersion(content) {
      const value = JSON.parse(content).version;
      if (typeof value !== 'string') {
        throw new Error('src-tauri/tauri.conf.json does not contain a string version');
      }
      return value;
    },
    update(content, version) {
      return replaceOnce(
        content,
        /("version"\s*:\s*)"[^"]+"/,
        '$1"' + version + '"',
        'src-tauri/tauri.conf.json version',
      );
    },
  },
];

function replaceOnce(content, pattern, replacement, label) {
  const globalPattern = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g',
  );
  const matches = content.match(globalPattern);
  if (!matches || matches.length !== 1) {
    throw new Error('Expected exactly one ' + label + ' match');
  }
  return content.replace(pattern, replacement);
}

function failUsage() {
  throw new Error('Usage: node scripts/bump-version.mjs <MAJOR.MINOR.PATCH> | --check');
}

async function main() {
  const argument = process.argv[2];
  if (process.argv.length !== 3 || (!/^\d+\.\d+\.\d+$/.test(argument) && argument !== '--check')) {
    failUsage();
  }

  const entries = await Promise.all(
    targets.map(async target => ({
      ...target,
      content: await readFile(join(root, target.path), 'utf8'),
    })),
  );
  const versions = entries.map(entry => entry.readVersion(entry.content));
  const uniqueVersions = [...new Set(versions)];
  if (uniqueVersions.length !== 1) {
    throw new Error('Version files are out of sync: ' + versions.join(', '));
  }

  const currentVersion = uniqueVersions[0];
  if (argument === '--check') {
    console.log('Kalio version files are synchronized at ' + currentVersion);
    return;
  }

  if (argument === currentVersion) {
    console.log('Kalio version is already ' + currentVersion);
    return;
  }

  for (const entry of entries) {
    await writeFile(join(root, entry.path), entry.update(entry.content, argument), 'utf8');
  }
  console.log('Updated Kalio version from ' + currentVersion + ' to ' + argument);
}

main().catch(error => {
  console.error('[release] ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
