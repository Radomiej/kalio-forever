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

const PRUNABLE_NODE_MODULE_DIRECTORIES = new Set([
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

const PRUNABLE_SERVER_ROOT_DIRECTORIES = [
  '.turbo',
  'coverage',
  'src',
  'src-tauri',
  'test',
  'tests',
  'tmp',
];

const PRUNABLE_SERVER_ROOT_FILES = [
  'desktop-server-bootstrap.mjs',
  'drizzle.config.ts',
  'eslint.config.mjs',
  'nest-cli.json',
  'tsconfig.json',
  'vitest.config.ts',
];

function isPrunableRuntimeFile(name) {
  const lowerName = name.toLowerCase();
  return lowerName.endsWith('.d.ts')
    || lowerName.endsWith('.map')
    || lowerName.endsWith('.ts')
    || lowerName.endsWith('.tsx')
    || /\.(spec|test)\.(c|m)?js$/i.test(name)
    || /^(readme|changelog|history|contributing)([-_.].*)?$/i.test(name);
}

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

async function pruneTree(directory) {
  let removedFiles = 0;
  let removedDirectories = 0;

  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (PRUNABLE_NODE_MODULE_DIRECTORIES.has(entry.name)) {
          await rm(entryPath, { recursive: true, force: true });
          removedDirectories += 1;
          return;
        }
        await visit(entryPath);
        return;
      }
      if (entry.isFile() && isPrunableRuntimeFile(entry.name)) {
        await rm(entryPath, { force: true });
        removedFiles += 1;
      }
    }));
  }

  await visit(directory);
  return { removedFiles, removedDirectories };
}

async function removeUnneededOnnxRuntimeArtifacts() {
  const onnxRoot = join(serverRoot, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
  const platformName = process.platform === 'win32'
    ? 'win32'
    : process.platform === 'linux'
      ? 'linux'
      : process.platform === 'darwin'
        ? 'darwin'
        : null;
  const architecture = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
  if (!platformName || !architecture) {
    return;
  }

  const targetRoot = join(onnxRoot, platformName, architecture);
  try {
    await stat(targetRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const platformEntries = await readdir(onnxRoot, { withFileTypes: true });
  await Promise.all(platformEntries
    .filter((entry) => entry.isDirectory() && entry.name !== platformName)
    .map((entry) => rm(join(onnxRoot, entry.name), { recursive: true, force: true })));

  const architectureEntries = await readdir(join(onnxRoot, platformName), { withFileTypes: true });
  await Promise.all(architectureEntries
    .filter((entry) => entry.isDirectory() && entry.name !== architecture)
    .map((entry) => rm(join(onnxRoot, platformName, entry.name), { recursive: true, force: true })));

  if (platformName === 'linux') {
    await Promise.all([
      rm(join(targetRoot, 'libonnxruntime_providers_cuda.so'), { force: true }),
      rm(join(targetRoot, 'libonnxruntime_providers_tensorrt.so'), { force: true }),
    ]);
  }
}

async function removeUnneededOnnxRuntimeWebArtifacts() {
  // Transformers.js loads only the /webgpu entry in the Node runtime. Keep its
  // bundle and asyncify binary; the remaining browser/provider variants are not
  // reachable from the desktop server and add tens of MiB to every installer.
  const onnxWebRoot = join(serverRoot, 'node_modules', 'onnxruntime-web');
  const distRoot = join(onnxWebRoot, 'dist');
  const keepDistFiles = new Set([
    'ort.webgpu.bundle.min.mjs',
    'ort.webgpu.min.js',
    'ort.webgpu.min.mjs',
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.asyncify.wasm',
  ]);

  await Promise.all([
    rm(join(onnxWebRoot, 'lib'), { recursive: true, force: true }),
    rm(join(onnxWebRoot, 'node_modules'), { recursive: true, force: true }),
  ]);

  let entries;
  try {
    entries = await readdir(distRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  await Promise.all(entries
    .filter((entry) => entry.isFile() && !keepDistFiles.has(entry.name))
    .map((entry) => rm(join(distRoot, entry.name), { force: true })));
}

async function pruneServerArtifacts() {
  await Promise.all(PRUNABLE_SERVER_ROOT_DIRECTORIES.map((name) => (
    rm(join(serverRoot, name), { recursive: true, force: true })
  )));
  await Promise.all(PRUNABLE_SERVER_ROOT_FILES.map((name) => (
    rm(join(serverRoot, name), { force: true })
  )));

  const nodeModulesRoot = join(serverRoot, 'node_modules');
  await rm(join(nodeModulesRoot, '@types'), { recursive: true, force: true });
  await pruneTree(nodeModulesRoot);
  await pruneTree(join(serverRoot, 'dist'));
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

  const imgRoots = [
    join(serverRoot, 'node_modules', '@img'),
    join(serverRoot, 'node_modules', 'sharp', 'node_modules', '@img'),
  ];
  await Promise.all(imgRoots.map(async (imgRoot) => {
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
  }));
}

async function removeMuslClaudeAgentSdk() {
  if (process.platform !== 'linux') {
    return;
  }

  await rm(
    join(serverRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64-musl'),
    { recursive: true, force: true },
  );
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
await removeMuslClaudeAgentSdk();
await removeUnneededOnnxRuntimeArtifacts();
await removeUnneededOnnxRuntimeWebArtifacts();
await ensureNativeSqliteAddon();
await requirePath(join(serverRoot, 'node_modules', 'reflect-metadata'), 'materialized API dependencies');

await rm(join(serverRoot, 'dist'), { recursive: true, force: true });
await cp(apiDist, join(serverRoot, 'dist'), { recursive: true });
await cp(bootstrapSource, join(serverRoot, 'runtime-server-bootstrap.mjs'));
await pruneServerArtifacts();

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
