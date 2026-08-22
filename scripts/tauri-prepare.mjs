import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resourcesRoot = join(root, 'src-tauri', 'resources');
const serverRoot = join(resourcesRoot, 'kalio-server');
const apiDist = join(root, 'apps', 'kalio-api', 'dist');
const sourceWebDist = join(root, 'apps', 'kalio-web', 'dist');
const webDist = join(root, 'src-tauri', 'frontend-dist');
const bootstrapSource = join(root, 'scripts', 'runtime-server-bootstrap.mjs');
const desktopBackendOrigin = 'http://127.0.0.1:4516';

function run(command, args, cwd = root) {
  const currentPath = process.env.PATH ?? process.env.Path ?? '';
  const systemPath = process.platform === 'win32'
    ? `C:\\Program Files\\nodejs;${currentPath}`
    : currentPath;
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      PATH: systemPath,
      ...(process.platform === 'win32' ? { Path: systemPath } : {}),
    },
    stdio: 'inherit',
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function getPnpmMajorVersion(pnpm) {
  const currentPath = process.env.PATH ?? process.env.Path ?? '';
  const systemPath = process.platform === 'win32'
    ? `C:\\Program Files\\nodejs;${currentPath}`
    : currentPath;
  const result = spawnSync(pnpm, ['--version'], {
    cwd: root,
    env: {
      ...process.env,
      PATH: systemPath,
      ...(process.platform === 'win32' ? { Path: systemPath } : {}),
    },
    encoding: 'utf8',
    shell: process.platform === 'win32' && pnpm.endsWith('.cmd'),
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`Unable to resolve ${pnpm} version`);
  }
  const major = Number.parseInt(result.stdout.trim().split('.')[0] ?? '', 10);
  if (!Number.isInteger(major)) {
    throw new Error(`Unable to parse pnpm version: ${result.stdout.trim()}`);
  }
  return major;
}

async function requirePath(path, label) {
  try {
    await stat(path);
  } catch (error) {
    throw new Error(`${label} is missing at ${path}: ${error.message}`);
  }
}

async function installFlatRuntimeDependencies() {
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
  const sourceRoot = join(root, 'apps', 'kalio-api', 'node_modules', 'better-sqlite3');
  const targetRoot = join(serverRoot, 'node_modules', 'better-sqlite3');
  const sourcePath = await findFile(sourceRoot, 'better_sqlite3.node');
  const existingTargetPath = await findFile(targetRoot, 'better_sqlite3.node');
  if (!sourcePath && !existingTargetPath) {
    throw new Error('The better-sqlite3 native addon is missing from both the workspace and Tauri staging');
  }
  if (sourcePath) {
    const targetPath = join(targetRoot, 'build', 'Release', 'better_sqlite3.node');
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { force: true });
  }
}
  const packageJsonPath = join(serverRoot, 'package.json');
  const manifest = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const runtimeDependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).filter(([name]) => name !== '@kalio/types'),
  );

  await writeFile(
    packageJsonPath,
    `${JSON.stringify({
      name: 'kalio-desktop-server',
      version: manifest.version,
      private: true,
      dependencies: runtimeDependencies,
    }, null, 2)}\n`,
    'utf8',
  );

  const nodeModulesRoot = join(serverRoot, 'node_modules');
  await rm(nodeModulesRoot, { recursive: true, force: true });
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  run(pnpm, [
    '--config.node-linker=hoisted',
    '--config.virtual-store-dir-max-length=40',
    '--ignore-workspace',
    '--no-lockfile',
    '--prod',
    'install',
  ], serverRoot);
}

async function removeBareRuntimePrebuilds() {
  if (process.platform !== 'linux') {
    return;
  }

  const nodeModulesRoot = join(serverRoot, 'node_modules');
  const entries = await readdir(nodeModulesRoot, { withFileTypes: true });
  const barePackages = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('bare-'));
  await Promise.all(
    barePackages.map((entry) => rm(join(nodeModulesRoot, entry.name, 'prebuilds'), { recursive: true, force: true })),
  );
}

async function removeMuslSharpPrebuilds() {
  if (process.platform !== 'linux') {
    return;
  }

  const imgRoot = join(serverRoot, 'node_modules', '@img');
  let entries;
  try {
    entries = await readdir(imgRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const muslPackages = entries.filter((entry) => entry.isDirectory() && entry.name.includes('linuxmusl'));
  await Promise.all(
    muslPackages.map((entry) => rm(join(imgRoot, entry.name), { recursive: true, force: true })),
  );
}

async function removeUnneededOnnxRuntimeArtifacts() {
  if (process.platform !== 'linux') {
    return;
  }

  const linuxRuntimeRoot = join(serverRoot, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'linux');
  await rm(join(linuxRuntimeRoot, 'arm64'), { recursive: true, force: true });
  await Promise.all([
    rm(join(linuxRuntimeRoot, 'x64', 'libonnxruntime_providers_cuda.so'), { force: true }),
    rm(join(linuxRuntimeRoot, 'x64', 'libonnxruntime_providers_tensorrt.so'), { force: true }),
  ]);
}

await rm(resourcesRoot, { recursive: true, force: true });
await rm(webDist, { recursive: true, force: true });
await mkdir(resourcesRoot, { recursive: true });
await cp(sourceWebDist, webDist, { recursive: true });

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const deployArgs = [
  '--config.virtual-store-dir-max-length=40',
  '--filter',
  'kalio-api',
  'deploy',
  '--prod',
  serverRoot,
];
if (getPnpmMajorVersion(pnpm) >= 10) {
  deployArgs.splice(deployArgs.length - 1, 0, '--legacy');
}
run(pnpm, deployArgs);

await requirePath(join(apiDist, 'main.js'), 'API build');
await requirePath(join(sourceWebDist, 'index.html'), 'web build');
await requirePath(bootstrapSource, 'desktop backend bootstrap');
await requirePath(join(serverRoot, 'node_modules'), 'deployed API dependencies');

await installFlatRuntimeDependencies();
await removeBareRuntimePrebuilds();
await removeMuslSharpPrebuilds();
await removeUnneededOnnxRuntimeArtifacts();
await ensureNativeSqliteAddon();
await requirePath(join(serverRoot, 'node_modules', 'reflect-metadata'), 'materialized API dependencies');

await rm(join(serverRoot, 'dist'), { recursive: true, force: true });
await cp(apiDist, join(serverRoot, 'dist'), { recursive: true });
await cp(bootstrapSource, join(serverRoot, 'runtime-server-bootstrap.mjs'));

const nodeResourceName = process.platform === 'win32' ? 'kalio-node.exe' : 'kalio-node';
const systemNode = process.platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : process.execPath;
const nodeBinary = process.env.KALIO_NODE_BINARY || (await requirePath(systemNode, 'system Node.js runtime').then(() => systemNode));
const stagedNodeBinary = join(resourcesRoot, nodeResourceName);
await cp(nodeBinary, stagedNodeBinary);
if (process.platform !== 'win32') {
  await chmod(stagedNodeBinary, 0o755);
}

const runtimeConfig = `window.__KALIO_RUNTIME_CONFIG__ = ${JSON.stringify({
  apiUrl: desktopBackendOrigin,
  wsUrl: desktopBackendOrigin,
})};\n`;
await writeFile(join(webDist, 'runtime-config.js'), runtimeConfig, 'utf8');

console.log(`[desktop] staged API resources in ${serverRoot}`);
console.log(`[desktop] bundled Node runtime in ${stagedNodeBinary}`);
console.log(`[desktop] staged frontend in ${webDist}; runtime config points to ${desktopBackendOrigin}`);

