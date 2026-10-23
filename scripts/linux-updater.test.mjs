import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

test('Linux updater selects, verifies and activates the Linux archive without modifying user data', { skip: process.platform !== 'linux', timeout: 10000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'kalio-linux-update-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'legacy home with spaces');
  const source = join(root, 'new-runtime');
  mkdirSync(join(source, 'bin'), { recursive: true });
  mkdirSync(join(home, 'app/versions/1.0.0'), { recursive: true });
  mkdirSync(join(home, 'data'), { recursive: true });
  writeFileSync(join(home, 'current.json'), JSON.stringify({ version: '1.0.0', runtime: 'node', platform: 'linux', architecture: 'x64' }));
  writeFileSync(join(home, 'data/sentinel'), 'keep');
  writeFileSync(join(source, 'runtime.json'), JSON.stringify({ version: '1.2.3', runtime: 'node', platform: 'linux', architecture: 'x64' }));
  writeFileSync(join(source, 'bin/kalio'), `#!/bin/sh\nprintf '%s\\n' "$KALIO_HOME" "$@"\n`, { mode: 0o755 });
  const archive = join(root, 'kalio-runtime-1.2.3-linux-x64.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', root, 'new-runtime']).status, 0);
  const bytes = readFileSync(archive);
  const payload = { schema: 1, tag: 'v1.2.3', version: '1.2.3', assets: [{ name: 'kalio-runtime-1.2.3-linux-x64.tar.gz', platform: 'linux', architecture: 'x64', runtime: 'node', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }] };
  let origin;
  const server = createServer((req, res) => {
    if (req.url === '/archive') return res.end(bytes);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/manifest') return res.end(JSON.stringify({ schema: 1, payload: Buffer.from(JSON.stringify(payload)).toString('base64') }));
    res.end(JSON.stringify({ tag_name: 'v1.2.3', assets: [{ name: 'kalio-runtime-manifest.json', browser_download_url: origin + '/manifest' }, { name: 'kalio-runtime-1.2.3-linux-x64.tar.gz', browser_download_url: origin + '/archive' }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const child = spawn(process.execPath, [resolve('scripts/kalio-updater.mjs'), '--home', home, '--api-url', origin + '/release', '--no-launch', '--allow-unsigned'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (b) => { output += b; });
  child.stderr.on('data', (b) => { output += b; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, output);
  assert.equal(JSON.parse(readFileSync(join(home, 'current.json'))).version, '1.2.3');
  assert.equal(readFileSync(join(home, 'data/sentinel'), 'utf8'), 'keep');
  assert.equal(existsSync(join(home, '.update.lock')), false);
  assert.equal(existsSync(join(home, 'app/versions/1.2.3/runtime.json')), true);
  const launcher = join(home, 'bin/kalio');
  assert.equal(existsSync(launcher), true, 'legacy updates must create the stable launcher');
  assert.equal(statSync(launcher).mode & 0o777, 0o755);
  const launched = spawnSync(launcher, ['doctor', 'argument with spaces'], {
    encoding: 'utf8', env: { ...process.env, KALIO_HOME: '/wrong/inherited/home' },
  });
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(launched.stdout, `${home}\ndoctor\nargument with spaces\n`);
  const managedWrapper = readFileSync(launcher, 'utf8') + '# managed wrapper must survive updates\n';
  writeFileSync(launcher, managedWrapper);
  writeFileSync(join(home, 'current.json'), JSON.stringify({ version: '1.0.0', runtime: 'node' }));
  const secondUpdate = spawn(process.execPath, [resolve('scripts/kalio-updater.mjs'), '--home', home, '--api-url', origin + '/release', '--no-launch', '--allow-unsigned'], { stdio: 'ignore' });
  assert.equal((await once(secondUpdate, 'exit'))[0], 0);
  assert.equal(readFileSync(launcher, 'utf8'), managedWrapper, 'existing managed launchers must remain untouched');
  writeFileSync(join(home, 'current.json'), JSON.stringify({ version: '../escape' }));
  assert.notEqual(spawnSync(launcher, ['doctor']).status, 0);

});
