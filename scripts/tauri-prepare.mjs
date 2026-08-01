import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resourcesRoot = join(root, 'src-tauri', 'resources');
const serverRoot = join(resourcesRoot, 'kalio-server');
const apiDist = join(root, 'apps', 'kalio-api', 'dist');
const webDist = join(root, 'apps', 'kalio-web', 'dist');
const bootstrapSource = join(root, 'scripts', 'desktop-server-bootstrap.mjs');
const desktopBackendOrigin = 'http://127.0.0.1:4516';

function run(command, args, cwd = root) {
  const currentPath = process.env.PATH ?? process.env.Path ?? '';
  const systemPath = `C:\\Program Files\\nodejs;${currentPath}`;
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, PATH: systemPath, Path: systemPath },
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

async function requirePath(path, label) {
  try {
    await stat(path);
  } catch (error) {
    throw new Error(`${label} is missing at ${path}: ${error.message}`);
  }
}

async function installFlatRuntimeDependencies() {
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

await rm(resourcesRoot, { recursive: true, force: true });
await mkdir(resourcesRoot, { recursive: true });

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
run(pnpm, [
  '--config.virtual-store-dir-max-length=40',
  '--filter',
  'kalio-api',
  'deploy',
  '--prod',
  serverRoot,
]);

await requirePath(join(apiDist, 'main.js'), 'API build');
await requirePath(join(webDist, 'index.html'), 'web build');
await requirePath(bootstrapSource, 'desktop backend bootstrap');
await requirePath(join(serverRoot, 'node_modules'), 'deployed API dependencies');

await installFlatRuntimeDependencies();
await requirePath(join(serverRoot, 'node_modules', 'reflect-metadata'), 'materialized API dependencies');

await rm(join(serverRoot, 'dist'), { recursive: true, force: true });
await cp(apiDist, join(serverRoot, 'dist'), { recursive: true });
await cp(bootstrapSource, join(serverRoot, 'desktop-server-bootstrap.mjs'));

const systemNode = 'C:\\Program Files\\nodejs\\node.exe';
const nodeBinary = process.env.KALIO_NODE_BINARY || (await requirePath(systemNode, 'system Node.js runtime').then(() => systemNode));
await cp(nodeBinary, join(resourcesRoot, 'kalio-node.exe'));

const runtimeConfig = `window.__KALIO_RUNTIME_CONFIG__ = ${JSON.stringify({
  apiUrl: desktopBackendOrigin,
  wsUrl: desktopBackendOrigin,
})};\n`;
await writeFile(join(webDist, 'runtime-config.js'), runtimeConfig, 'utf8');

console.log(`[desktop] staged API resources in ${serverRoot}`);
console.log(`[desktop] bundled Node runtime in ${join(resourcesRoot, 'kalio-node.exe')}`);
console.log(`[desktop] frontend runtime config points to ${desktopBackendOrigin}`);
