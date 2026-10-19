import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';

const load = () => import('./stack-port-owners.mjs');
const row = (port, pid, state = 'LISTENING', address = '0.0.0.0') =>
  `  TCP    ${address}:${port}    0.0.0.0:0    ${state}    ${pid}\r\n`;

test('Windows resolves a port group with one query and preserves port identities', async () => {
  const { resolveListeningPids } = await load();
  const calls = [];
  const owners = await resolveListeningPids([3316, 5288, 3316, 0], {
    platform: 'win32', run: async (command, args) => {
      calls.push({ command, args });
      return { code: 0, stdout: row(3316, 101) + row(5288, 202, 'LISTENING', '[::]') + row(3316, 101) + row(6188, 404) + row(3316, 505, 'ESTABLISHED') };
    },
  });
  assert.deepEqual([...owners], [[3316, 101], [5288, 202]]);
  assert.equal(calls.length, 1, 'one OS query per group, not per port');
  assert.match(calls[0].command, /[\\/]netstat\.exe$/i);
  assert.deepEqual(calls[0].args, ['-ano', '-p', 'tcp']);
});

test('later lookup rechecks ownership rather than using a cached PID', async () => {
  const { resolveListeningPids } = await load();
  let queries = 0;
  const options = { platform: 'win32', run: async () => ({
    code: 0, stdout: row(3316, ++queries === 1 ? 101 : 303),
  }) };
  assert.equal((await resolveListeningPids([3316], options)).get(3316), 101);
  assert.equal((await resolveListeningPids([3316], options)).get(3316), 303);
  assert.equal(queries, 2);
});

test('query failure and malformed ownership fail closed', async () => {
  const { resolveListeningPids } = await load();
  for (const result of [
    { code: 1, stdout: '' }, { code: 0, stdout: 'not a port owner' },
    { code: 0, stdout: row(3316, 0) }, { code: 0, stdout: ' TCP broken' },
    { code: 0, stdout: row(3316, 101) + row(3316, 202) },
  ]) {
    await assert.rejects(resolveListeningPids([3316], {
      platform: 'win32', run: async () => result,
    }));
  }
});

test('Windows accepts localized headings without treating arbitrary output as empty ownership', async () => {
  const { resolveListeningPids } = await load();
  const owners = await resolveListeningPids([3316], {
    platform: 'win32', run: async () => ({ code: 0,
      stdout: 'Aktywne połączenia\r\n\r\n  Proto  Adres lokalny  Adres obcy  Stan  PID\r\n' + row(3316, 101),
    }),
  });
  assert.equal(owners.get(3316), 101);
});

test('empty successful lookup is distinct from failure and zero needs no query', async () => {
  const { resolveListeningPids } = await load();
  assert.equal((await resolveListeningPids([3316, 5288], {
    platform: 'win32', run: async () => ({ code: 0, stdout: '' }),
  })).size, 0);
  assert.equal((await resolveListeningPids([0], {
    platform: 'win32', run: async () => { throw new Error('must not query'); },
  })).size, 0);
});

test('non-Windows keeps lsof owner lookup and treats exit 1 empty as no listener', async () => {
  const { resolveListeningPids } = await load();
  const owners = await resolveListeningPids([3316, 5288], {
    platform: 'linux', run: async (command, args) => {
      assert.equal(command, 'lsof');
      assert.equal(args[1], '-sTCP:LISTEN');
      return args[0] === '-tiTCP:3316'
        ? { code: 0, stdout: '101\n101\n' } : { code: 1, stdout: '' };
    },
  });
  assert.deepEqual([...owners], [[3316, 101]]);
});

test('real Windows lookup identifies two live listeners and observes closure',
  { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
    const { resolveListeningPids } = await load();
    const servers = [createServer(), createServer()];
    try {
      const ports = await Promise.all(servers.map(server => new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
      })));
      const owners = await resolveListeningPids(ports);
      assert.equal(owners.get(ports[0]), process.pid);
      assert.equal(owners.get(ports[1]), process.pid);
      await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
      assert.equal((await resolveListeningPids(ports)).size, 0);
    } finally {
      for (const server of servers) if (server.listening) server.close();
    }
  });

for (const platform of ['linux', 'darwin']) {
  test(`${platform} missing lsof leaves listener ownership unknown`, async () => {
    const { resolveListeningPids } = await load();
    assert.equal((await resolveListeningPids([3316], {
      platform, run: async () => { throw Object.assign(new Error('lsof missing'), { code: 'ENOENT' }); },
    })).size, 0);
  });
}

test('non-Windows query errors other than missing lsof still fail closed', async () => {
  const { resolveListeningPids } = await load();
  for (const code of ['EACCES', 'ETIMEDOUT']) {
    await assert.rejects(resolveListeningPids([3316], {
      platform: 'linux', run: async () => { throw Object.assign(new Error('query failure'), { code }); },
    }), { code });
  }
  await assert.rejects(resolveListeningPids([3316], {
    platform: 'linux', run: async () => ({ code: 2, stdout: '' }),
  }), /ownership query failed/);
});

test('startup with missing lsof checks real binds and never reuses an unrelated healthy service', async (t) => {
  const { ensureRequestedPortsAreFree } = await load();
  const service = createServer(socket => socket.end('healthy unrelated service'));
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close());
  const port = service.address().port;
  const options = { platform: 'linux', run: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } };
  await assert.rejects(ensureRequestedPortsAreFree([port], options), /already in use; listener ownership unknown/);
  assert.equal(service.listening, true, 'the existing service must remain untouched');
  await new Promise(resolve => service.close(resolve));
  await ensureRequestedPortsAreFree([port], options);
  await new Promise(resolve => service.listen(port, '127.0.0.1', resolve));
  assert.equal(service.listening, true, 'the probe must release its listener after checking a free port');
});

test('actual stack start without lsof refuses an unrelated live service before build or health polling', { skip: process.platform === 'win32', timeout: 10000 }, async (t) => {
  const { mkdtemp, mkdir, copyFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const root = await mkdtemp(join(tmpdir(), 'kalio-no-lsof-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  for (const name of ['stack-manager.mjs', 'stack-port-owners.mjs', 'stack-state.mjs', 'stack-status.mjs']) {
    await copyFile(new URL(name, import.meta.url), join(root, 'scripts', name));
  }
  const server = createServer(socket => socket.end('unrelated healthy service'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const child = spawn(process.execPath, [join(root, 'scripts/stack-manager.mjs'), 'start', '--backend-port', String(server.address().port), '--frontend-port', '0'], {
    cwd: root, env: { ...process.env, PATH: root }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.notEqual(code, 0);
  assert.match(output, /already in use; listener ownership unknown/);
  assert.doesNotMatch(output, /ENOENT|Building|is healthy/);
  assert.equal(server.listening, true);
});
