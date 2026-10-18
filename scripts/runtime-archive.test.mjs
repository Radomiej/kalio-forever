import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs, { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createRuntimeArchive } from './runtime-archive.mjs';

const execute = promisify(execFile);
const requireAPI = createRequire(new URL('../apps/kalio-api/package.json', import.meta.url));
const extractZip = requireAPI('extract-zip');
test('windows: exact 260-character model path and paths beyond 330 characters survive archive round-trip', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kalio-archive-long-'));
  try {
    const packageName = 'kalio-runtime-fixture';
    const model = 'server/node_modules/@huggingface/transformers/src/models/audio_spectrogram_transformer/feature_extraction_audio_spectrogram_transformer.js';
    const padding = 260 - join(directory, 'x', packageName, model).length + 1;
    assert.ok(padding > 0);
    const stagingParent = join(directory, 's'.repeat(padding));
    const source = join(stagingParent, packageName);
    const modelPath = join(source, model);
    assert.equal(modelPath.length, 260);
    const deep = join(source, ...Array(7).fill('long Unicode spaced segment żółć 日本語'), 'payload.bin');
    assert.ok(deep.length > 330);
    await mkdir(dirname(modelPath), { recursive: true }); await writeFile(modelPath, 'exact model bytes');
    await mkdir(dirname(deep), { recursive: true }); await writeFile(deep, Buffer.from([0, 255, 128, 13, 10]));
    const archive = join(directory, 'runtime.zip');
    await createRuntimeArchive({ platform: 'windows', archive, stagingParent, packageName });
    const extracted = join(directory, 'extracted');
    await extractZip(archive, { dir: extracted });
    assert.deepEqual(await tree(join(extracted, packageName)), await tree(source));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
async function fixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'kalio-archive-test-'));
  try {
    const stagingParent = join(directory, 'staging source źródło 日本語');
    const packageName = 'kalio runtime źródło';
    const source = join(stagingParent, packageName);
    await mkdir(join(source, 'empty directory'), { recursive: true });
    const bytes = Buffer.alloc(1024 * 1024);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256;
    const files = new Map([
      ['server/node_modules/@nestjs/websockets/exceptions/index.js', Buffer.from('exports.WebSocketException = class {};\n')],
      ['nested path/żółć 日本語.txt', Buffer.from('Unicode content: ąćęłńóśźż 日本語\n')],
      ['all bytes.bin', bytes], ['empty file', Buffer.alloc(0)], ['.hidden-runtime-file', Buffer.from('hidden data')],
    ]);
    for (const [name, content] of files) {
      await mkdir(dirname(join(source, name)), { recursive: true });
      await writeFile(join(source, name), content);
    }
    if (process.platform === 'win32') {
      const hidden = join(source, '.hidden-runtime-file');
      await execute('attrib.exe', ['+h', hidden], { windowsHide: true });
      const attributes = await execute('attrib.exe', [hidden], { windowsHide: true });
      assert.match(attributes.stdout, /H/);
    }
    return await callback({ directory, stagingParent, packageName, source });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function tree(root, prefix = '') {
  const entries = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isDirectory()) {
      entries.push([name + '/', null], ...await tree(join(root, item.name), name + '/'));
    } else entries.push([name, await readFile(join(root, item.name))]);
  }
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

for (const platform of ['windows', 'linux']) {
  const options = { skip: platform === 'linux' && process.platform !== 'linux' };
  test(`${platform}: real archive round-trip preserves exact tree, binary bytes and existing-output replacement`, options, async () => {
    await fixture(async ({ directory, stagingParent, packageName, source }) => {
      const archive = join(directory, platform === 'windows' ? 'runtime output żółć 日本語.zip' : 'runtime output.tar.gz');
      await writeFile(archive, 'previous archive');
      await createRuntimeArchive({ platform, archive, stagingParent, packageName });
      const magic = (await readFile(archive)).subarray(0, 2);
      assert.deepEqual([...magic], platform === 'windows' ? [0x50, 0x4b] : [0x1f, 0x8b]);
      const extracted = join(directory, 'extracted'); await mkdir(extracted);
      if (platform === 'windows') await extractZip(archive, { dir: extracted });
      else await execute('tar', ['-xf', archive, '-C', extracted]);
      assert.deepEqual(await readdir(extracted), [packageName]);
      assert.deepEqual(await tree(join(extracted, packageName)), await tree(source));
      assert.equal((await readdir(directory)).filter(name => name.startsWith('.runtime-archive-')).length, 0);
    });
  });

  test(`${platform}: missing input rejects and preserves the current archive without temporary output`, options, async () => {
    await fixture(async ({ directory, stagingParent, packageName }) => {
      const archive = join(directory, 'existing archive'); const original = Buffer.from('previous valid artifact\0\xff');
      await writeFile(archive, original);
      await assert.rejects(createRuntimeArchive({ platform, archive, stagingParent, packageName: packageName + '-missing' }));
      assert.deepEqual(await readFile(archive), original);
      assert.equal((await readdir(directory)).filter(name => name.startsWith('.runtime-archive-')).length, 0);
    });
  });

  test(`${platform}: replacement failure preserves the old target and cleans owned temporary output`, options, async () => {
    await fixture(async ({ directory, stagingParent, packageName }) => {
      const archive = join(directory, 'occupied target'); await mkdir(archive);
      await writeFile(join(archive, 'keep'), 'existing target content');
      await assert.rejects(createRuntimeArchive({ platform, archive, stagingParent, packageName }));
      assert.equal(await readFile(join(archive, 'keep'), 'utf8'), 'existing target content');
      assert.equal((await readdir(directory)).filter(name => name.startsWith('.runtime-archive-')).length, 0);
    });
  });
}

async function controlledArchive(t, configure, check) {
  const directory = await mkdtemp(join(tmpdir(), 'kalio-archive-fault-'));
  try {
    const archive = join(directory, 'archive'); await writeFile(archive, 'original archive');
    const forwarded = [];
    t.mock.method(process.stderr, 'write', chunk => { forwarded.push(chunk); return true; });
    const child = new EventEmitter();
    Object.assign(child, { stderr: new PassThrough(), exitCode: null, signalCode: null, killed: false });
    child.kill = () => {
      child.killed = true;
      queueMicrotask(() => { child.signalCode = 'SIGTERM'; child.emit('close', null, 'SIGTERM'); });
      return true;
    };
    t.mock.method(childProcess, 'spawn', (_command, args) => {
      const output = args[1]; // Controlled Linux branch: -czf <temporary-output>.
      configure(child, output);
      return child;
    });
    await check({ archive, directory, child, forwarded,
      run: () => createRuntimeArchive({ platform: 'linux', archive, stagingParent: directory, packageName: 'fixture' }) });
  } finally { t.mock.restoreAll(); await rm(directory, { recursive: true, force: true }); }
}

test('nonzero child exit rejects and preserves the current archive', async t => {
  await controlledArchive(t, child => queueMicrotask(() => {
    child.exitCode = 7; child.emit('close', 7, null);
  }), async ({ archive, run }) => {
    await assert.rejects(run(), /exit=7/);
    assert.equal(await readFile(archive, 'utf8'), 'original archive');
  });
});

for (const event of ['error', 'stderr EPIPE']) {
  test(`${event}: failure cannot clean temporary output or settle before owned child close ACK`, async t => {
    let notifyKill; const killed = new Promise(resolveKill => { notifyKill = resolveKill; });
    const error = Object.assign(new Error(event), { code: event === 'error' ? 'ENOENT' : 'EPIPE' });
    await controlledArchive(t, (child, output) => {
      writeFileSync(output, 'partial output');
      child.kill = () => { child.killed = true; notifyKill(); return true; };
      queueMicrotask(() => event === 'error' ? child.emit('error', error) : child.stderr.emit('error', error));
    }, async ({ archive, directory, child, run }) => {
      let settled = false;
      const result = run().then(() => { settled = true; return null; }, failure => { settled = true; return failure; });
      try {
        await killed;
        assert.equal(await readFile(archive, 'utf8'), 'original archive');
        const owned = (await readdir(directory)).filter(name => name.startsWith('.runtime-archive-'));
        assert.equal(owned.length, 1, 'owned output must remain until close');
        assert.equal(settled, false);
      } finally { child.signalCode = 'SIGTERM'; child.emit('close', null, 'SIGTERM'); }
      assert.equal((await result).cause, error);
      assert.equal((await readdir(directory)).some(name => name.startsWith('.runtime-archive-')), false);
    });
  });
}

test('known omission warning survives chunk boundaries and diagnostic truncation despite exit zero', async t => {
  await controlledArchive(t, (child, output) => {
    writeFileSync(output, 'incomplete artifact');
    queueMicrotask(() => {
      child.stderr.write("Can't add arch"); child.stderr.write('ive to itself');
      child.stderr.write(' '.repeat(70 * 1024));
      child.exitCode = 0; child.emit('close', 0, null);
    });
  }, async ({ archive, run }) => {
    await assert.rejects(run(), /Can't add archive to itself/);
    assert.equal(await readFile(archive, 'utf8'), 'original archive');
  });
});

test('ordinary diagnostic stderr alone does not reject a successful child', async t => {
  await controlledArchive(t, (child, output) => {
    writeFileSync(output, 'complete archive');
    queueMicrotask(() => { child.stderr.write('tar: diagnostic only\n'); child.exitCode = 0; child.emit('close', 0, null); });
  }, async ({ archive, run, forwarded }) => {
    await run(); assert.equal(await readFile(archive, 'utf8'), 'complete archive');
    assert.equal(forwarded.join(''), 'tar: diagnostic only\n');
  });
});

test('synchronous spawn failure preserves the existing archive and removes temporary output', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kalio-archive-spawn-'));
  try {
    const archive = join(directory, 'archive'); await writeFile(archive, 'original');
    t.mock.method(childProcess, 'spawn', () => { throw new Error('spawn refused'); });
    await assert.rejects(createRuntimeArchive({ platform: 'linux', archive, stagingParent: directory, packageName: 'fixture' }), /spawn refused/);
    assert.equal(await readFile(archive, 'utf8'), 'original');
    assert.deepEqual(await readdir(directory), ['archive']);
  } finally { t.mock.restoreAll(); await rm(directory, { recursive: true, force: true }); }
});

for (const event of ['error', 'warning', 'output error', 'synchronous setup with late error']) {
  test(`ZIP ${event} rejects, closes owned resources and preserves the existing archive`, async t => {
    await fixture(async ({ directory, stagingParent, packageName }) => {
      const destination = join(directory, 'current.zip'); await writeFile(destination, 'original ZIP');
      const factory = requireAPI('archiver'); const probe = factory('zip'); const prototype = Object.getPrototypeOf(probe);
      probe.destroy();
      const failure = new Error(`ZIP ${event}`);
      let producer; let producerClosed = false; let outputClosed = false;
      const createOutput = fs.createWriteStream;
      t.mock.method(fs, 'createWriteStream', (...args) => {
        if (event === 'synchronous setup with late error') throw failure;
        const stream = createOutput(...args);
        stream.once('close', () => { outputClosed = true; });
        if (event === 'output error') queueMicrotask(() => stream.destroy(failure));
        return stream;
      });
      const originalPipe = prototype.pipe;
      t.mock.method(prototype, 'pipe', function (...args) {
        producer = this; this.once('close', () => { producerClosed = true; });
        return originalPipe.apply(this, args);
      });
      t.mock.method(prototype, 'directory', function () {
        if (event === 'error' || event === 'warning') queueMicrotask(() => this.emit(event, failure));
        return this;
      });
      const originalDestroy = prototype.destroy;
      t.mock.method(prototype, 'destroy', function (...args) {
        if (event === 'synchronous setup with late error') {
          producer = this; this.once('close', () => { producerClosed = true; });
          queueMicrotask(() => this.emit('error', new Error('late producer error after setup failure')));
        }
        return originalDestroy.apply(this, args);
      });
      try {
        await assert.rejects(createRuntimeArchive({ platform: 'windows', archive: destination, stagingParent, packageName }),
          error => error.cause === failure);
        assert.ok(producer);
        assert.equal(producerClosed, true);
        if (event !== 'synchronous setup with late error') assert.equal(outputClosed, true);
        assert.equal(await readFile(destination, 'utf8'), 'original ZIP');
        assert.equal((await readdir(directory)).some(name => name.startsWith('.runtime-archive-')), false);
      } finally { t.mock.restoreAll(); }
    });
  });
}
