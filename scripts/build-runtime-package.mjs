import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const platformIndex = args.indexOf('--platform');
const outputIndex = args.indexOf('--output');
const runtimeIndex = args.indexOf('--runtime');
const platform = platformIndex >= 0 ? args[platformIndex + 1] : process.platform === 'win32' ? 'windows' : 'linux';
const outputRoot = resolve(root, outputIndex >= 0 ? args[outputIndex + 1] : 'release');
const runtime = runtimeIndex >= 0 ? args[runtimeIndex + 1] : 'node';

if (!['windows', 'linux'].includes(platform)) {
  throw new Error('Runtime packages support only windows and linux');
}
if (!['node', 'bun'].includes(runtime)) {
  throw new Error('Runtime packages support only node and bun runtimes');
}

const version = process.env.KALIO_RELEASE_VERSION
  ?? JSON.parse(await readFile(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;
const packageName = 'kalio-runtime-' + version + (runtime === 'bun' ? '-bun' : '') + '-' + platform + '-x64';
const stagingParent = join(outputRoot, '.staging');
const stageRoot = join(stagingParent, packageName);
const serverRoot = join(stageRoot, 'server');
const apiDist = join(root, 'apps', 'kalio-api', 'dist');
const webDist = join(root, 'apps', 'kalio-web', 'dist');
const bootstrapSource = join(root, 'scripts', 'runtime-server-bootstrap.mjs');
const cliSource = join(root, 'scripts', 'kalio-cli.mjs');

function run(command, commandArgs, cwd = root) {
  const currentPath = process.env.PATH ?? process.env.Path ?? '';
  const systemPath = process.platform === 'win32'
    ? 'C:\\Program Files\\nodejs;' + currentPath
    : currentPath;
  const result = spawnSync(command, commandArgs, {
    cwd,
    env: {
      ...process.env,
      PATH: systemPath,
      ...(process.platform === 'win32' ? { Path: systemPath } : {}),
    },
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(command + ' ' + commandArgs.join(' ') + ' exited with code ' + result.status);
  }
}

async function requirePath(path, label) {
  try {
    await stat(path);
  } catch (error) {
    throw new Error(label + ' is missing at ' + path + ': ' + error.message);
  }
}

async function findFile(directory, fileName) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const nestedPath = await findFile(entryPath, fileName);
      if (nestedPath) {
        return nestedPath;
      }
    }
  }
  return null;
}

async function ensureNativeSqliteAddon() {
  if (runtime === 'bun') {
    return;
  }
  const sourceRoot = join(root, 'apps', 'kalio-api', 'node_modules', 'better-sqlite3');
  const targetRoot = join(serverRoot, 'node_modules', 'better-sqlite3');
  const sourcePath = await findFile(sourceRoot, 'better_sqlite3.node');
  const existingTargetPath = await findFile(targetRoot, 'better_sqlite3.node');
  if (!sourcePath && !existingTargetPath) {
    throw new Error('The better-sqlite3 native addon is missing from both the workspace and runtime staging');
  }
  if (sourcePath) {
    const targetPath = join(targetRoot, 'build', 'Release', 'better_sqlite3.node');
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { force: true });
    console.log('[kalio] bundled better-sqlite3 native addon: ' + sourcePath);
  }
}

async function resolveExecutable(explicitPath, command, label) {
  if (explicitPath) {
    await requirePath(explicitPath, label);
    return explicitPath;
  }
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [command], { encoding: 'utf8', windowsHide: true });
  if (result.status === 0) {
    const resolvedPath = result.stdout.trim().split(/\r?\n/)[0];
    if (resolvedPath) {
      await requirePath(resolvedPath, label);
      return resolvedPath;
    }
  }
  throw new Error(`${label} was not found; set ${command === 'bun' ? 'KALIO_BUN_BINARY' : 'KALIO_NODE_BINARY'}`);
}


function getPnpm() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function getPnpmMajor(pnpm) {
  const result = spawnSync(pnpm, ['--version'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32' && pnpm.endsWith('.cmd'),
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error('Unable to resolve pnpm version');
  }
  const major = Number.parseInt(result.stdout.trim().split('.')[0] ?? '', 10);
  if (!Number.isInteger(major)) {
    throw new Error('Unable to parse pnpm version: ' + result.stdout.trim());
  }
  return major;
}

async function installFlatRuntimeDependencies() {
  const packageJsonPath = join(serverRoot, 'package.json');
  const manifest = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const runtimeDependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).filter(([name]) => (
      name !== '@kalio/types' && (runtime !== 'bun' || name !== 'better-sqlite3')
    )),
  );
  await writeFile(packageJsonPath, JSON.stringify({
    name: 'kalio-runtime-server',
    version,
    private: true,
    dependencies: runtimeDependencies,
  }, null, 2) + '\n', 'utf8');
  await rm(join(serverRoot, 'node_modules'), { recursive: true, force: true });
  run(getPnpm(), [
    '--config.node-linker=hoisted',
    '--config.virtual-store-dir-max-length=40',
    '--ignore-workspace',
    '--no-lockfile',
    '--prod',
    'install',
  ], serverRoot);
}

const PRUNABLE_DIRECTORIES = new Set([
  '.bin',
  '.github',
  '.pnpm',
  '__mocks__',
  '__tests__',
  'benchmark',
  'benchmarks',
  'docs',
  'example',
  'examples',
  'test',
  'tests',
]);

function isPrunableFile(name) {
  const lowerName = name.toLowerCase();
  return lowerName.endsWith('.d.ts')
    || lowerName.endsWith('.map')
    || lowerName.endsWith('.ts')
    || lowerName.endsWith('.tsx')
    || /^(readme|changelog|history|contributing)([-_.].*)?$/i.test(name);
}

async function pruneRuntimeArtifacts() {
  const nodeModulesRoot = join(serverRoot, 'node_modules');
  let removedFiles = 0;
  let removedDirectories = 0;

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (PRUNABLE_DIRECTORIES.has(entry.name)) {
          await rm(entryPath, { recursive: true, force: true });
          removedDirectories += 1;
          return;
        }
        await visit(entryPath);
        return;
      }
      if (entry.isFile() && isPrunableFile(entry.name)) {
        await rm(entryPath, { force: true });
        removedFiles += 1;
      }
    }));
  }

  await rm(join(nodeModulesRoot, '@types'), { recursive: true, force: true });
  await visit(nodeModulesRoot);
  return { removedFiles, removedDirectories };
}

async function measureTree(directory) {
  let files = 0;
  let bytes = 0;

  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (entry.isFile()) {
        const fileStats = await stat(entryPath);
        files += 1;
        bytes += fileStats.size;
      }
    }
  }

  await visit(directory);
  return { files, bytes };
}
async function removeLinuxOptionalArtifacts() {
  if (platform !== 'linux') {
    return;
  }
  const nodeModulesRoot = join(serverRoot, 'node_modules');
  const entries = await readdir(nodeModulesRoot, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('bare-'))
    .map((entry) => rm(join(nodeModulesRoot, entry.name, 'prebuilds'), { recursive: true, force: true })));
  const imgRoot = join(nodeModulesRoot, '@img');
  try {
    const imageEntries = await readdir(imgRoot, { withFileTypes: true });
    await Promise.all(imageEntries
      .filter((entry) => entry.isDirectory() && entry.name.includes('linuxmusl'))
      .map((entry) => rm(join(imgRoot, entry.name), { recursive: true, force: true })));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

await rm(stagingParent, { recursive: true, force: true });
await mkdir(serverRoot, { recursive: true });
await mkdir(outputRoot, { recursive: true });
await requirePath(join(apiDist, 'main.js'), 'API build');
await requirePath(join(webDist, 'index.html'), 'web build');

const deployArgs = [
  '--config.virtual-store-dir-max-length=40',
  '--filter',
  'kalio-api',
  'deploy',
  '--prod',
  serverRoot,
];
const pnpm = getPnpm();
if (getPnpmMajor(pnpm) >= 10) {
  deployArgs.splice(deployArgs.length - 1, 0, '--legacy');
}
run(pnpm, deployArgs);
await installFlatRuntimeDependencies();
await removeLinuxOptionalArtifacts();
await rm(join(serverRoot, 'dist'), { recursive: true, force: true });
await cp(apiDist, join(serverRoot, 'dist'), { recursive: true });
await ensureNativeSqliteAddon();
await cp(bootstrapSource, join(serverRoot, 'runtime-server-bootstrap.mjs'));
await cp(webDist, join(stageRoot, 'web'), { recursive: true });
await writeFile(
  join(stageRoot, 'web', 'runtime-config.js'),
  'window.__KALIO_RUNTIME_CONFIG__ = {};\n',
  'utf8',
);
await cp(cliSource, join(stageRoot, 'bin', 'kalio-cli.mjs'));

const runtimeName = runtime === 'bun'
  ? platform === 'windows' ? 'kalio-bun.exe' : 'kalio-bun'
  : platform === 'windows' ? 'kalio-node.exe' : 'kalio-node';
const defaultNode = platform === 'windows' ? 'C:\\Program Files\\nodejs\\node.exe' : process.execPath;
const pruneResult = await pruneRuntimeArtifacts();
const dependencyMetrics = await measureTree(join(serverRoot, 'node_modules'));
console.log(
  '[kalio] runtime dependency footprint: '
    + dependencyMetrics.files
    + ' files, '
    + Math.round(dependencyMetrics.bytes / 1024 / 1024)
    + ' MiB; pruned '
    + pruneResult.removedFiles
    + ' files and '
    + pruneResult.removedDirectories
    + ' directories',
);
const runtimeBinary = runtime === 'bun'
  ? await resolveExecutable(process.env.KALIO_BUN_BINARY, 'bun', 'bundled Bun runtime')
  : process.env.KALIO_NODE_BINARY ?? defaultNode;
await requirePath(runtimeBinary, runtime === 'bun' ? 'bundled Bun runtime' : 'bundled Node.js runtime');
await cp(runtimeBinary, join(stageRoot, 'bin', runtimeName));
if (platform === 'linux') {
  await chmod(join(stageRoot, 'bin', runtimeName), 0o755);
  await writeFile(
    join(stageRoot, 'bin', 'kalio'),
    `#!/bin/sh\nset -eu\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$SCRIPT_DIR/${runtimeName}" "$SCRIPT_DIR/kalio-cli.mjs" "$@"\n`,
    { encoding: 'utf8', mode: 0o755 },
  );
} else {
  await writeFile(
    join(stageRoot, 'bin', 'kalio.cmd'),
    `@echo off\r\n"%~dp0${runtimeName}" "%~dp0kalio-cli.mjs" %*\r\n`,
    'utf8',
  );
}

const metadata = {
  runtime,
  name: 'Kalio Runtime',
  version,
  platform,
  architecture: 'x64',
  apiProtocolVersion: '1',
  databaseSchemaVersion: '1',
  ui: 'embedded',
  installRoot: 'Kalio',
  dataRoot: 'data',
};
await writeFile(join(stageRoot, 'runtime.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8');
for (const file of ['LICENSE', 'COMMERCIAL-LICENSE.md', 'COMMERCIAL-LICENSE-AGREEMENT-TEMPLATE.md']) {
  try {
    await cp(join(root, file), join(stageRoot, file));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

const archive = join(
  outputRoot,
  packageName + (platform === 'windows' ? '.zip' : '.tar.gz'),
);
const archiveArgs = platform === 'windows'
  ? ['-a', '-c', '-f', archive, '-C', stagingParent, packageName]
  : ['-czf', archive, '-C', stagingParent, packageName];
run('tar', archiveArgs);
await rm(stagingParent, { recursive: true, force: true });
console.log('[kalio] runtime package created: ' + archive);

