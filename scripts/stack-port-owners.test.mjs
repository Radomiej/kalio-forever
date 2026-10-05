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
