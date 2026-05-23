#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(scriptDir, '..');
const comparePath = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

function isInsidePath(childPath, parentPath) {
  const child = comparePath(resolve(childPath));
  const parent = comparePath(resolve(parentPath));
  return child === parent || child.startsWith(`${parent}${sep}`);
}

const modulesManifestPath = resolve(repoRoot, 'node_modules/.modules.yaml');
const requiredOutputs = [
  { label: 'types package dist', path: resolve(repoRoot, 'packages/@kalio/types/dist/index.js') },
  { label: 'types package declarations', path: resolve(repoRoot, 'packages/@kalio/types/dist/index.d.ts') },
  { label: 'sdk package dist', path: resolve(repoRoot, 'packages/@kalio/sdk/dist/index.js') },
  { label: 'sdk package declarations', path: resolve(repoRoot, 'packages/@kalio/sdk/dist/index.d.ts') },
];

const requiredWorkspaceLinks = [
  { label: '@kalio/types link in kalio-api', path: resolve(repoRoot, 'apps/kalio-api/node_modules/@kalio/types'), target: resolve(repoRoot, 'packages/@kalio/types') },
  { label: '@kalio/types link in kalio-web', path: resolve(repoRoot, 'apps/kalio-web/node_modules/@kalio/types'), target: resolve(repoRoot, 'packages/@kalio/types') },
  { label: '@kalio/sdk link in kalio-web', path: resolve(repoRoot, 'apps/kalio-web/node_modules/@kalio/sdk'), target: resolve(repoRoot, 'packages/@kalio/sdk') },
];

const isRepair = process.argv.includes('--repair');

const nodeDir = resolve(process.execPath, '..');
const nodeBinDir = resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'nodejs');
const corepackEntryPoint = resolve(nodeBinDir, 'node_modules/corepack/dist/corepack.js');
const localCorepackEntryPoint = resolve(nodeDir, 'node_modules/corepack/dist/corepack.js');

const baseRepairEnv = {
  ...process.env,
  NPM_CONFIG_CACHE: resolve(repoRoot, '.npm-cache'),
  npm_config_cache: resolve(repoRoot, '.npm-cache'),
  npm_config_devdir: resolve(repoRoot, '.node-gyp'),
};

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function fileExists(filePath) {
  return existsSync(filePath);
}

function isAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function resolvePath(cmd) {
  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  const dirs = pathValue.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
  for (const dir of dirs) {
    const candidate = resolve(dir, cmd);
    if (existsSync(candidate)) {
      return isAbsolutePath(candidate) ? candidate : resolve(candidate);
    }
  }
  return null;
}

function pnpmCommandCandidates() {
  const candidates = [];
  const pnpmCmd = resolvePath(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  if (pnpmCmd) {
    candidates.push({ command: pnpmCmd, argsPrefix: [], useShell: false });
  }

  if (process.platform === 'win32') {
    const corepackCmd = resolvePath('corepack.cmd');
    if (corepackCmd) {
      candidates.push({ command: corepackCmd, argsPrefix: ['pnpm'], useShell: true });
    }
  }

  const useCorepack = process.platform === 'win32' ? (existsSync(localCorepackEntryPoint) ? localCorepackEntryPoint : existsSync(corepackEntryPoint) ? corepackEntryPoint : null) : localCorepackEntryPoint;
  if (useCorepack) {
    candidates.push({ command: process.execPath, argsPrefix: [useCorepack, 'pnpm'], useShell: false });
  }

  return candidates;
}

async function runCommand(label, args, { env, cwd } = {}) {
  const candidates = pnpmCommandCandidates();
  if (candidates.length === 0) {
    throw new Error(`Unable to resolve pnpm launcher for command: ${label}`);
  }

  const commandFailures = [];
  for (const candidate of candidates) {
    const result = await new Promise((resolvePromise) => {
      const child = spawn(
        candidate.command,
        [...candidate.argsPrefix, ...args],
        {
          cwd: cwd ?? repoRoot,
          env,
          stdio: 'inherit',
          shell: candidate.useShell,
        },
      );

      child.once('error', (error) => {
        commandFailures.push(error.message);
        resolvePromise({ code: 1, command: candidate.command });
      });
      child.once('exit', (code) => {
        resolvePromise({ code: code ?? 0, command: candidate.command });
      });
    });

    if (result.code === 0) {
      return;
    }
  }

  throw new Error(`${label} failed with ${commandFailures.join('; ')}`);
}

async function checkModulesManifest(report) {
  if (!fileExists(modulesManifestPath)) {
    report.missingModulesManifest = true;
    return;
  }

  const text = readText(modulesManifestPath);
  const requiredKeys = ['hoistPattern:', 'hoistedDependencies:', 'layoutVersion:', 'virtualStoreDir:', 'nodeLinker:'];
  for (const key of requiredKeys) {
    if (!text.includes(key)) {
      report.invalidModulesManifest = true;
      return;
    }
  }
}

function checkWorkspaceLinks(report) {
  for (const link of requiredWorkspaceLinks) {
    if (!existsSync(link.path)) {
      report.workspaceLinks.push(link);
      continue;
    }

    try {
      const realPath = realpathSync(link.path);
      const realTarget = realpathSync(link.target);
      if (!isInsidePath(realPath, realTarget)) {
        report.workspaceLinks.push(link);
      }
    } catch {
      report.workspaceLinks.push(link);
    }
  }
}

async function checkBetterSqlite3Binding(report) {
  const apiDir = resolve(repoRoot, 'apps/kalio-api');
  const script = `const Database = require('better-sqlite3'); const db = new Database(':memory:'); const row = db.prepare('select 1 as v').get(); if (!row || row.v !== 1) { throw new Error('sqlite binding test failed'); } db.close();`;
  const result = await new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      ['-e', script],
      {
        cwd: apiDir,
        stdio: 'ignore',
      },
    );

    child.once('error', (error) => {
      resolvePromise({ ok: false, error: error.message });
    });
    child.once('exit', (code) => {
      resolvePromise({ ok: code === 0, code });
    });
  });

  if (!result.ok) {
    report.betterSqlite3 = true;
  }
}

function checkBuildOutputs(report) {
  for (const output of requiredOutputs) {
    if (!fileExists(output.path)) {
      report.buildOutputs.push(output);
      continue;
    }
    try {
      const stats = statSync(output.path);
      if (!stats.isFile() || stats.size === 0) {
        report.buildOutputs.push(output);
      }
    } catch {
      report.buildOutputs.push(output);
    }
  }
}

async function runRepairs(report) {
  mkdirSync(resolve(repoRoot, '.npm-cache'), { recursive: true });
  mkdirSync(resolve(repoRoot, '.node-gyp'), { recursive: true });
  const repairEnv = {
    ...baseRepairEnv,
    npm_config_devdir: resolve(repoRoot, '.node-gyp'),
  };

  if (report.missingModulesManifest || report.invalidModulesManifest || report.workspaceLinks.length > 0) {
    await runCommand('pnpm install (manifest/workspace repair)', ['install'], { env: repairEnv });
  }

  if (report.buildOutputs.length > 0 || report.betterSqlite3) {
    await runCommand('pnpm build (shared packages)', ['--filter', '@kalio/types', 'build'], { env: repairEnv });
    await runCommand('pnpm build (shared packages)', ['--filter', '@kalio/sdk', 'build'], { env: repairEnv });
    await runCommand('pnpm build (backend)', ['--filter', 'kalio-api', 'build'], { env: repairEnv });
    await runCommand('pnpm build (frontend)', ['--filter', 'kalio-web', 'build'], { env: repairEnv });
    await runCommand('pnpm rebuild (better-sqlite3)', ['--filter', 'kalio-api', 'rebuild', 'better-sqlite3'], { env: repairEnv });
  }
}

async function runChecks() {
  const report = {
    missingModulesManifest: false,
    invalidModulesManifest: false,
    workspaceLinks: [],
    betterSqlite3: false,
    buildOutputs: [],
  };

  await checkModulesManifest(report);
  checkWorkspaceLinks(report);
  await checkBetterSqlite3Binding(report);
  checkBuildOutputs(report);

  return report;
}

function printReport(report) {
  if (report.missingModulesManifest) {
    console.error('[preflight] missing: node_modules/.modules.yaml');
  }
  if (report.invalidModulesManifest) {
    console.error('[preflight] invalid: node_modules/.modules.yaml does not expose required fields');
  }
  for (const link of report.workspaceLinks) {
    console.error(`[preflight] missing/broken workspace link: ${link.label} -> ${link.path}`);
  }
  if (report.betterSqlite3) {
    console.error('[preflight] better-sqlite3 native binding test failed');
  }
  for (const output of report.buildOutputs) {
    console.error(`[preflight] missing: shared/build output ${output.label} (${output.path})`);
  }
}

function hasFailures(report) {
  return report.missingModulesManifest
    || report.invalidModulesManifest
    || report.workspaceLinks.length > 0
    || report.betterSqlite3
    || report.buildOutputs.length > 0;
}

console.log('KALIO repo preflight');

const report = await runChecks();
if (!hasFailures(report)) {
  console.log('[preflight] all checks passed');
  process.exit(0);
}

printReport(report);

if (!isRepair) {
  console.error('[preflight] preflight failed. Re-run with --repair.');
  process.exit(1);
}

console.log('[preflight] attempting repair...');
await runRepairs(report);

const repairedReport = await runChecks();
if (hasFailures(repairedReport)) {
  console.error('[preflight] repair finished but checks still failing.');
  printReport(repairedReport);
  process.exit(1);
}

console.log('[preflight] repair completed');
