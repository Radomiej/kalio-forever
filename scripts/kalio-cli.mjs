import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { open, readFile, rm, stat } from 'node:fs/promises';
import readline from 'node:readline/promises';


function getHome() {
  if (process.env.KALIO_HOME) {
    return resolve(process.env.KALIO_HOME);
  }
  if (process.platform === 'win32') {
    return resolve(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Kalio');
  }
  return resolve(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'kalio',
  );
}

async function readCurrent(home) {
  const currentPath = join(home, 'current.json');
  const current = JSON.parse(await readFile(currentPath, 'utf8'));
  if (typeof current.version !== 'string' || !current.version) {
    throw new Error('current.json does not contain a runtime version');
  }
  const versionsRoot = resolve(home, 'app', 'versions');
  const versionRoot = resolve(versionsRoot, current.version);
  const separator = process.platform === 'win32' ? String.fromCharCode(92) : '/';
  const allowedRoot = versionsRoot + separator;
  if (!versionRoot.startsWith(allowedRoot)) {
    throw new Error('current.json points outside the installed versions directory');
  }
  return { current, versionRoot };
}

async function acquireLock(home) {
  const lockPath = join(home, '.runtime.lock');
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
    return { handle, lockPath };
  } catch (error) {
    if (error?.code === 'EEXIST') {
      let owner = 'unknown';
      try {
        owner = (await readFile(lockPath, 'utf8')).trim();
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
      throw new Error('Another Kalio runtime appears to be running: ' + owner);
    }
    throw error;
  }
}

async function releaseLock(lock) {
  if (!lock) {
    return;
  }
  await lock.handle.close();
  await rm(lock.lockPath, { force: true });
}

function openBrowser(url) {
  if (process.env.KALIO_NO_OPEN === 'true') {
    return;
  }
  const command = process.platform === 'win32'
    ? ['cmd.exe', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function runServer(openUi) {
  const home = getHome();
  const { current, versionRoot } = await readCurrent(home);
  const serverRoot = join(versionRoot, 'server');
  const bootstrap = join(serverRoot, 'runtime-server-bootstrap.mjs');
  const runtime = current.runtime === 'bun' ? 'bun' : 'node';
  const runtimeName = runtime === 'bun' ? process.platform === 'win32' ? 'kalio-bun.exe' : 'kalio-bun' : process.platform === 'win32' ? 'kalio-node.exe' : 'kalio-node';
  const runtimePath = join(versionRoot, 'bin', runtimeName);
  const port = process.env.KALIO_PORT ?? '4016';
  await stat(bootstrap);
  await stat(runtimePath);
  const lock = await acquireLock(home);
  const child = spawn(runtimePath, [bootstrap], {
    cwd: serverRoot,
    env: {
      ...process.env,
      KALIO_HOME: home,
      KALIO_DATA_ROOT: join(home, 'data'),
      KALIO_WEB_ROOT: join(versionRoot, 'web'),
      KALIO_RUNTIME_VERSION: current.version,
      KALIO_PORT: port,
      KALIO_INSTALL_PROFILE: 'runtime',
      KALIO_SQLITE_DRIVER: process.env.KALIO_SQLITE_DRIVER ?? runtime,
    },
    stdio: 'inherit',
    windowsHide: false,
  });

  if (openUi) {
    openBrowser('http://127.0.0.1:' + port);
  }

  const exitCode = await new Promise((resolveExit) => {
    child.once('error', (error) => {
      console.error('[kalio] runtime spawn failed:', error);
      resolveExit(1);
    });
    child.once('exit', (code, signal) => {
      if (signal) {
        console.error('[kalio] runtime exited with signal ' + signal);
      }
      resolveExit(code ?? 1);
    });
  });
  await releaseLock(lock);
  process.exitCode = exitCode;
}

async function doctor() {
  const home = getHome();
  const { current, versionRoot } = await readCurrent(home);
  await stat(join(versionRoot, 'runtime.json'));
  await stat(join(versionRoot, 'server', 'dist', 'main.js'));
  await stat(join(versionRoot, 'web', 'index.html'));
  const port = process.env.KALIO_PORT ?? '4016';
  let response = 'offline';
  try {
    const result = await fetch('http://127.0.0.1:' + port + '/api/runtime/info', {
      signal: AbortSignal.timeout(1500),
    });
    response = result.ok ? await result.text() : 'http ' + result.status;
  } catch (error) {
    response = 'offline (' + (error instanceof Error ? error.message : String(error)) + ')';
  }
  console.log(JSON.stringify({
    home,
    currentVersion: current.version,
    runtime: current.runtime === 'bun' ? 'bun' : 'node',
    versionRoot,
    runtimeInfo: response,
  }, null, 2));
}

async function update(args) {
  const home = getHome();
  const { current, versionRoot } = await readCurrent(home);
  const updaterPath = join(versionRoot, 'bin', 'kalio-updater.mjs');
  const runtimeName = current.runtime === 'bun'
    ? process.platform === 'win32' ? 'kalio-bun.exe' : 'kalio-bun'
    : process.platform === 'win32' ? 'kalio-node.exe' : 'kalio-node';
  const runtimePath = join(versionRoot, 'bin', runtimeName);
  await stat(updaterPath);
  await stat(runtimePath);

  const auto = args.includes('--auto');
  const child = spawn(runtimePath, [updaterPath, ...args], {
    cwd: versionRoot,
    detached: !auto,
    env: {
      ...process.env,
      KALIO_HOME: home,
      KALIO_DATA_ROOT: join(home, 'data'),
    },
    stdio: auto ? 'inherit' : 'ignore',
    windowsHide: !auto,
  });
  if (!auto) {
    child.unref();
    console.log('[kalio] update started in a separate process; see logs/updater.log');
    return;
  }
  const exitCode = await new Promise((resolveExit) => {
    child.once('error', (error) => {
      console.error('[kalio] updater spawn failed:', error);
      resolveExit(1);
    });
    child.once('exit', (code, signal) => {
      if (signal) {
        console.error('[kalio] updater exited with signal ' + signal);
      }
      resolveExit(code ?? 1);
    });
  });
  process.exitCode = exitCode;
}

async function uninstall(args) {
  const home = getHome();
  const purgeData = args.includes('--purge-data');
  const appRoot = join(home, 'app');
  await rm(appRoot, { recursive: true, force: true });
  await rm(join(home, 'bin'), { recursive: true, force: true });
  await rm(join(home, 'current.json'), { force: true });
  if (purgeData) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question('Delete Kalio data at ' + join(home, 'data') + '? [y/N] ');
    prompt.close();
    if (['y', 'yes'].includes(answer.trim().toLowerCase())) {
      await rm(join(home, 'data'), { recursive: true, force: true });
      console.log('[kalio] data removed');
    } else {
      console.log('[kalio] data preserved');
    }
  } else {
    console.log('[kalio] data preserved at ' + join(home, 'data'));
  }
}

const [command = 'start', ...args] = process.argv.slice(2);
try {
  if (command === 'doctor') {
    await doctor();
  } else if (command === 'update') {
    await update(args);
  } else if (command === 'uninstall') {
    await uninstall(args);
  } else if (command === 'serve') {
    await runServer(false);
  } else if (command === 'start' || command === 'run') {
    await runServer(!args.includes('--no-open'));
  } else {
    throw new Error('Unknown command: ' + command + '. Use start, serve, update, doctor, or uninstall.');
  }
} catch (error) {
  console.error('[kalio] ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
