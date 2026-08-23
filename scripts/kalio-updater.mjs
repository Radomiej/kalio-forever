import {
  appendFile,
  cp,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  downloadFile,
  findFile,
  isVersionNewer,
  loadRelease,
  sha256File,
  verifyUpdateSignature,
} from './kalio-updater-helpers.mjs';

export { isVersionNewer, verifyUpdateSignature };

const DEFAULT_REPOSITORY = 'Radomiej/kalio-forever';
const LOCK_TIMEOUT_MS = 20_000;
const HEALTH_TIMEOUT_MS = 30_000;

function getHome() {
  if (process.env.KALIO_HOME) {
    return resolve(process.env.KALIO_HOME);
  }
  if (process.platform === 'win32') {
    return resolve(
      process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local'),
      'Kalio',
    );
  }
  return resolve(
    process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? '', '.local', 'share'),
    'kalio',
  );
}

function parseArgs(argv) {
  const options = {
    allowDowngrade: false,
    allowUnsigned: process.env.KALIO_REQUIRE_UPDATE_SIGNATURE !== 'true',
    apiUrl: process.env.KALIO_UPDATE_RELEASE_API_URL ?? '',
    force: false,
    home: getHome(),
    noLaunch: false,
    repository: process.env.KALIO_UPDATE_REPOSITORY ?? DEFAULT_REPOSITORY,
    runtime: '',
    version: 'latest',
    auto: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') {
      options.force = true;
    } else if (argument === '--auto') {
      options.auto = true;
    } else if (argument === '--no-launch') {
      options.noLaunch = true;
    } else if (argument === '--allow-downgrade') {
      options.allowDowngrade = true;
    } else if (argument === '--allow-unsigned') {
      options.allowUnsigned = true;
    } else if (argument === '--home') {
      options.home = resolve(argv[++index] ?? '');
    } else if (argument === '--repository') {
      options.repository = argv[++index] ?? '';
    } else if (argument === '--runtime') {
      options.runtime = argv[++index] ?? '';
    } else if (argument === '--version') {
      options.version = argv[++index] ?? '';
    } else if (argument === '--api-url') {
      options.apiUrl = argv[++index] ?? '';
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error('Unknown updater argument: ' + argument);
    }
  }

  if (options.help) {
    return options;
  }
  if (!['node', 'bun', ''].includes(options.runtime)) {
    throw new Error('Runtime must be node or bun');
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
    throw new Error('Repository must have the form owner/name');
  }
  return options;
}

function printHelp() {
  console.log(`Kalio standalone updater

Usage:
  kalio update [--force] [--no-launch] [--runtime node|bun]

The updater downloads a published GitHub Release, verifies its SHA-256 manifest,
optionally verifies an Ed25519 signature, installs beside the old version, then
switches current.json atomically and health-checks the new runtime.
`);
}

async function logMessage(home, message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log('[kalio] ' + message);
  try {
    await mkdir(join(home, 'logs'), { recursive: true });
    await appendFile(join(home, 'logs', 'updater.log'), line + '\n', 'utf8');
  } catch (error) {
    // Logging must not prevent an otherwise safe update.
    void error;
  }
}

async function readCurrent(home) {
  const current = JSON.parse(await readFile(join(home, 'current.json'), 'utf8'));
  if (typeof current.version !== 'string' || !current.version) {
    throw new Error('current.json does not contain a runtime version');
  }
  if (!['node', 'bun'].includes(current.runtime)) {
    throw new Error('current.json contains an unsupported runtime');
  }
  const versionsRoot = resolve(home, 'app', 'versions');
  const versionRoot = resolve(versionsRoot, current.version);
  const separator = process.platform === 'win32' ? '\\' : '/';
  if (!versionRoot.startsWith(versionsRoot + separator)) {
    throw new Error('current.json points outside the installed versions directory');
  }
  await stat(versionRoot);
  return { current, versionRoot };
}

async function readLock(home) {
  try {
    return JSON.parse(await readFile(join(home, '.runtime.lock'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function runCommand(command, args) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
}

function readWindowsProcess(pid) {
  const query = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress)`;
  return new Promise((resolveProcess, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', query],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Unable to inspect Kalio process ${pid}`));
        return;
      }
      const trimmed = output.trim();
      try {
        resolveProcess(trimmed ? JSON.parse(trimmed) : null);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function isRuntimeProcessOwned(home, processInfo) {
  const homeText = String(home);
  const absoluteHome = /^[A-Za-z]:[\\/]/.test(homeText) || homeText.startsWith('\\\\')
    ? homeText
    : resolve(homeText);
  const versionsRoot = join(absoluteHome, 'app', 'versions').replaceAll('/', '\\').toLowerCase() + '\\';
  const executablePath = String(processInfo?.ExecutablePath ?? '').replaceAll('/', '\\').toLowerCase();
  const commandLine = String(processInfo?.CommandLine ?? '').replaceAll('/', '\\').toLowerCase();
  return executablePath.startsWith(versionsRoot)
    && commandLine.includes(versionsRoot)
    && commandLine.includes('kalio-cli.mjs');
}

async function waitForLockRelease(home) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await readLock(home))) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Kalio did not stop within the update timeout');
}

async function stopRuntime(home, force) {
  const lock = await readLock(home);
  if (!lock) {
    return;
  }
  const pid = Number(lock.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('Runtime lock contains an invalid PID');
  }
  if (!force) {
    throw new Error('Kalio is running; use `kalio update --force` after saving active work');
  }
  if (process.platform === 'win32') {
    const processInfo = await readWindowsProcess(pid);
    if (!processInfo) {
      await logMessage(home, `WARNING: runtime PID ${pid} is gone; removing its stale runtime lock`);
      await rm(join(home, '.runtime.lock'), { force: true });
      return;
    }
    if (!isRuntimeProcessOwned(home, processInfo)) {
      throw new Error(`Runtime lock PID ${pid} does not belong to this Kalio installation; refusing --force`);
    }
    const exitCode = await runCommand('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
    if (exitCode !== 0) {
      await logMessage(home, `WARNING: taskkill returned ${exitCode}; waiting for the runtime lock`);
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        throw error;
      }
    }
  }
  await waitForLockRelease(home);
}

async function acquireUpdateLock(home) {
  const lockPath = join(home, '.update.lock');
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
    return { handle, lockPath };
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('Another Kalio update is already in progress');
    }
    throw error;
  }
}

async function releaseUpdateLock(lock) {
  await lock.handle.close();
  await rm(lock.lockPath, { force: true });
}

async function extractArchive(archivePath, extractionRoot) {
  await mkdir(extractionRoot, { recursive: true });
  const exitCode = await runCommand(
    process.platform === 'win32' ? 'tar.exe' : 'tar',
    process.platform === 'win32'
      ? ['-xf', archivePath, '-C', extractionRoot]
      : ['-xzf', archivePath, '-C', extractionRoot],
  );
  if (exitCode !== 0) {
    throw new Error('Runtime archive extraction failed');
  }
}

function assertSafeVersion(version) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
    throw new Error('Runtime manifest contains an invalid version');
  }
}

async function writeCurrent(home, current) {
  const currentPath = join(home, 'current.json');
  const temporaryPath = join(home, `current.json.${process.pid}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(current, null, 2) + '\n', 'utf8');
  await rename(temporaryPath, currentPath);
}

async function startRuntime(home) {
  const launcher = join(home, 'bin', process.platform === 'win32' ? 'kalio.cmd' : 'kalio');
  await stat(launcher);
  const child = spawn(launcher, ['serve'], {
    cwd: home,
    detached: true,
    shell: process.platform === 'win32',
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function waitForHealthy(home, expectedVersion) {
  const port = process.env.KALIO_PORT ?? '4016';
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runtime/info`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        const info = await response.json();
        if (info.version === expectedVersion && info.embeddedUi === true) {
          return;
        }
      }
    } catch (error) {
      // The new process may still be starting.
      void error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`New Kalio runtime ${expectedVersion} did not become healthy`);
}

async function installArchive(home, archivePath, expected) {
  const extractionRoot = join(home, 'cache', `update-extract-${process.pid}`);
  try {
    await extractArchive(archivePath, extractionRoot);
    const metadataPath = await findFile(extractionRoot, 'runtime.json');
    if (!metadataPath) {
      throw new Error('runtime.json is missing from the runtime archive');
    }
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (
      metadata.version !== expected.releaseVersion
      || metadata.runtime !== expected.runtime
      || metadata.platform !== 'windows'
      || metadata.architecture !== 'x64'
    ) {
      throw new Error('Runtime archive metadata does not match the verified release asset');
    }
    assertSafeVersion(metadata.version);
    const sourceRoot = resolve(metadataPath, '..');
    const versionsRoot = resolve(home, 'app', 'versions');
    const versionRoot = resolve(versionsRoot, metadata.version);
    if (!versionRoot.startsWith(versionsRoot + '\\')) {
      throw new Error('Runtime archive version escapes the install directory');
    }
    await mkdir(versionsRoot, { recursive: true });
    await rm(versionRoot, { recursive: true, force: true });
    await cp(sourceRoot, versionRoot, { recursive: true, force: true });
    return {
      versionRoot,
      current: {
        version: metadata.version,
        runtime: metadata.runtime,
        platform: metadata.platform,
        architecture: metadata.architecture,
        apiProtocolVersion: metadata.apiProtocolVersion,
        databaseSchemaVersion: metadata.databaseSchemaVersion,
      },
    };
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

async function applyUpdate(options) {
  const home = resolve(options.home);
  const { current, versionRoot } = await readCurrent(home);
  const expected = await loadRelease(options, { current, versionRoot });
  if (expected.releaseVersion === current.version && expected.runtime === current.runtime) {
    await logMessage(home, `Already up to date at ${current.version} (${current.runtime})`);
    return;
  }
  if (!options.allowDowngrade && !isVersionNewer(expected.releaseVersion, current.version)) {
    throw new Error(`Release ${expected.releaseVersion} is not newer than installed ${current.version}`);
  }
  const updateLock = await acquireUpdateLock(home);
  const updateDir = join(home, 'cache', 'updates', `${expected.releaseVersion}-${expected.runtime}`);
  const archivePath = join(updateDir, expected.asset.name);
  const previousCurrent = { ...current };
  try {
    await mkdir(updateDir, { recursive: true });
    await logMessage(home, `Downloading ${expected.asset.name}`);
    await downloadFile(expected.asset.browser_download_url, archivePath);
    const actualSha256 = await sha256File(archivePath);
    if (actualSha256 !== expected.expectedSha256) {
      throw new Error(`Runtime SHA-256 mismatch: expected ${expected.expectedSha256}, got ${actualSha256}`);
    }
    await stopRuntime(home, options.force);
    const installed = await installArchive(home, archivePath, expected);
    await writeCurrent(home, installed.current);
    await logMessage(home, `Installed ${installed.current.version} (${installed.current.runtime})`);
    if (!options.noLaunch) {
      try {
        await startRuntime(home);
        await waitForHealthy(home, installed.current.version);
      } catch (error) {
        await logMessage(home, 'New runtime failed health check; rolling back to the previous version');
        await stopRuntime(home, true);
        await writeCurrent(home, previousCurrent);
        await startRuntime(home);
        throw error;
      }
      await logMessage(home, `Kalio ${installed.current.version} is healthy`);
    }
  } finally {
    await releaseUpdateLock(updateLock);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  await applyUpdate(options);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    await main();
  } catch (error) {
    console.error('[kalio] updater failed: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
