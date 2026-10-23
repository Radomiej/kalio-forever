import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';

const installer = resolve('scripts/install.sh');

function fixture(t, version = '1.2.3') {
  const root = mkdtempSync(join(tmpdir(), 'kalio-linux-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = join(root, 'runtime');
  mkdirSync(join(runtime, 'bin'), { recursive: true });
  mkdirSync(join(runtime, 'server'), { recursive: true });
  mkdirSync(join(runtime, 'web'), { recursive: true });
  writeFileSync(join(runtime, 'runtime.json'), JSON.stringify({ version, platform: 'linux', architecture: 'x64', runtime: 'node' }, null, 2));
  writeFileSync(join(runtime, 'bin/kalio-node'), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
  writeFileSync(join(runtime, 'bin/kalio'), '#!/bin/sh\ndir=$(dirname "$0")\nexec "$dir/kalio-node" "$dir/kalio-cli.mjs" "$@"\n', { mode: 0o755 });
  writeFileSync(join(runtime, 'bin/kalio-cli.mjs'), 'console.log(JSON.stringify({home:process.env.KALIO_HOME,args:process.argv.slice(2)}));\n');
  writeFileSync(join(runtime, 'bin/kalio.png'), 'png-bytes');
  const archive = join(root, 'runtime.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', root, 'runtime']).status, 0);
  const home = join(root, 'custom install');
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const install = (...args) => spawnSync('bash', [installer, '--archive', archive, '--install-root', home, '--no-launch', ...args], { encoding: 'utf8', env: { ...process.env, XDG_DATA_HOME: join(root, 'xdg-data') } });
  return { root, archive, home, digest, install };
}

test('Linux installation creates a stable launcher bound to a custom home with spaces', { skip: process.platform !== 'linux' }, (t) => {
  const f = fixture(t);
  const result = f.install('--sha256', f.digest);
  assert.equal(result.status, 0, result.stderr);
  const launched = spawnSync(join(f.home, 'bin/kalio'), ['doctor'], { encoding: 'utf8' });
  assert.equal(launched.status, 0, launched.stderr);
  assert.deepEqual(JSON.parse(launched.stdout), { home: f.home, args: ['doctor'] });
  assert.equal(statSync(join(f.home, 'data/.env')).mode & 0o777, 0o600);
});

test('reinstall preserves configuration and user data', { skip: process.platform !== 'linux' }, (t) => {
  const f = fixture(t);
  assert.equal(f.install().status, 0);
  const env = readFileSync(join(f.home, 'data/.env'));
  writeFileSync(join(f.home, 'data/sentinel.txt'), 'keep me');
  assert.equal(f.install().status, 0);
  assert.deepEqual(readFileSync(join(f.home, 'data/.env')), env);
  assert.equal(readFileSync(join(f.home, 'data/sentinel.txt'), 'utf8'), 'keep me');
});

test('stable launcher follows the version selected by an updater', { skip: process.platform !== 'linux' }, (t) => {
  const f = fixture(t);
  assert.equal(f.install().status, 0);
  const bin = join(f.home, 'app/versions/1.2.4/bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'kalio'), '#!/bin/sh\nprintf "updated-version\\n"\n', { mode: 0o755 });
  writeFileSync(join(f.home, 'current.json'), JSON.stringify({ version: '1.2.4', runtime: 'node' }));
  const launched = spawnSync(join(f.home, 'bin/kalio'), ['doctor'], { encoding: 'utf8' });
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(launched.stdout.trim(), 'updated-version');
});

test('checksum mismatch never activates an installation', { skip: process.platform !== 'linux' }, (t) => {
  const f = fixture(t);
  const result = f.install('--sha256', '0'.repeat(64));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum|SHA-256/i);
  assert.equal(existsSync(join(f.home, 'current.json')), false);
});

test('a runtime lock prevents replacement and preserves current state', { skip: process.platform !== 'linux' }, (t) => {
  const f = fixture(t);
  assert.equal(f.install().status, 0);
  const current = readFileSync(join(f.home, 'current.json'));
  writeFileSync(join(f.home, '.runtime.lock'), '{}');
  assert.notEqual(f.install().status, 0);
  assert.deepEqual(readFileSync(join(f.home, 'current.json')), current);
});

function releaseFixture(t, mutate = (payload) => payload) {
  const f = fixture(t);
  const asset = { name: 'kalio-runtime-1.2.3-linux-x64.tar.gz', platform: 'linux', architecture: 'x64', runtime: 'node', sha256: f.digest, size: statSync(f.archive).size };
  const payload = mutate({ schema: 1, tag: 'v1.2.3', version: '1.2.3', assets: [asset] });
  const manifest = join(f.root, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({ schema: 1, payload: Buffer.from(JSON.stringify(payload)).toString('base64') }));
  const bin = join(f.root, 'fake-bin');
  mkdirSync(bin);
  const fetcher = join(f.root, 'curl.mjs');
  writeFileSync(fetcher, `import {copyFileSync} from 'node:fs';
const args=process.argv.slice(2), url=args.find(x=>x.startsWith('https://'));
if(url.endsWith('/releases/latest')) { console.log(JSON.stringify({tag_name:'v1.2.3'})); }
else { const out=args[args.indexOf('-o')+1];
if(url.endsWith('/kalio-runtime-manifest.json')) copyFileSync(process.env.TEST_MANIFEST,out);
else if(url.endsWith('/kalio-runtime-1.2.3-linux-x64.tar.gz')) copyFileSync(process.env.TEST_ARCHIVE,out);
else throw new Error('Unexpected download '+url); }
`);
  writeFileSync(join(bin, 'curl'), `#!/bin/sh\nexec '${process.execPath}' '${fetcher}' "$@"\n`, { mode: 0o755 });
  const run = (...extra) => spawnSync('bash', [resolve('scripts/install-release.sh'), '--install-root', f.home, '--no-launch', ...extra], {
    encoding: 'utf8', env: { ...process.env, PATH: bin + delimiter + process.env.PATH, TEST_MANIFEST: manifest, TEST_ARCHIVE: f.archive, XDG_DATA_HOME: join(f.root, 'xdg-data') },
  });
  return { ...f, run, manifest };
}

test('release bootstrap verifies metadata and installs the matching archive', { skip: process.platform !== 'linux' }, (t) => {
  const f = releaseFixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /integrity verified/);
  assert.equal(JSON.parse(readFileSync(join(f.home, 'current.json'))).version, '1.2.3');
  assert.equal(existsSync(join(f.home, 'bin/kalio')), true);
});

test('release bootstrap refuses a tampered archive before touching the install', { skip: process.platform !== 'linux' }, (t) => {
  const f = releaseFixture(t, (payload) => { payload.assets[0].sha256 = '0'.repeat(64); return payload; });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256 or size mismatch/);
  assert.equal(existsSync(f.home), false);
});

test('release bootstrap refuses a manifest for another release', { skip: process.platform !== 'linux' }, (t) => {
  const f = releaseFixture(t, (payload) => ({ ...payload, tag: 'v9.9.9' }));
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match/);
  assert.equal(existsSync(f.home), false);
});

test('signed releases require a trusted public key and reject an invalid signature', { skip: process.platform !== 'linux' }, (t) => {
  const f = releaseFixture(t);
  const manifest = JSON.parse(readFileSync(f.manifest));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  manifest.signatureAlgorithm = 'ed25519';
  manifest.signature = sign(null, Buffer.from(manifest.payload, 'base64'), privateKey).toString('base64');
  writeFileSync(f.manifest, JSON.stringify(manifest));
  assert.notEqual(f.run().status, 0, 'a signed release must not silently fall back to hashes');
  const key = join(f.root, 'trusted-public.pem');
  writeFileSync(key, publicKey.export({ type: 'spki', format: 'pem' }));
  const verified = f.run('--public-key', key);
  assert.equal(verified.status, 0, verified.stderr);
  const current = readFileSync(join(f.home, 'current.json'));
  manifest.signature = Buffer.alloc(64).toString('base64');
  writeFileSync(f.manifest, JSON.stringify(manifest));
  assert.notEqual(f.run('--public-key', key).status, 0);
  assert.deepEqual(readFileSync(join(f.home, 'current.json')), current);
});

test('install creates a desktop entry launching kalio start and --no-desktop-icon removes it', { skip: process.platform !== 'linux' }, (t) => {
  const f = fixture(t);
  assert.equal(f.install().status, 0);
  const desktopFile = join(f.root, 'xdg-data', 'applications', 'kalio.desktop');
  assert.equal(existsSync(desktopFile), true);
  const entry = readFileSync(desktopFile, 'utf8');
  assert.match(entry, /^Exec="[^"]*kalio" start$/m);
  assert.match(entry, /^Icon=.*bin\/kalio\.png$/m);
  assert.equal(existsSync(join(f.home, 'bin/kalio.png')), true);
  assert.equal(f.install('--no-desktop-icon').status, 0);
  assert.equal(existsSync(desktopFile), false);
});
