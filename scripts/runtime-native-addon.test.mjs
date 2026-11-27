import test from 'node:test';
import assert from 'node:assert/strict';
import fsPromises, { link, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyNativeAddon } from './runtime-native-addon.mjs';

test('cached native addon hardlinks are already staged and must not be copied onto themselves', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kalio-native-addon-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source.node');
  const target = join(root, 'staged.node');
  await writeFile(source, 'workspace native addon');
  await link(source, target);
  const sourceInfo = await stat(source, { bigint: true });
  const targetInfo = await stat(target, { bigint: true });
  assert.notEqual(sourceInfo.ino, 0n);
  assert.equal(sourceInfo.ino, targetInfo.ino);
  assert.equal(sourceInfo.dev, targetInfo.dev);
  const copy = t.mock.method(fsPromises, 'cp', async () => {
    assert.fail('An already staged hardlink must not be copied');
  });
  syncBuiltinESMExports();
  try {
    await copyNativeAddon(source, target);
    assert.equal(copy.mock.callCount(), 0);
  } finally {
    copy.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(await readFile(target, 'utf8'), 'workspace native addon');
  assert.equal(await readFile(source, 'utf8'), 'workspace native addon');
});

test('a different staged native addon is replaced and a missing target is created', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kalio-native-addon-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source.node');
  const target = join(root, 'staged.node');
  await writeFile(source, 'correct workspace ABI');
  await copyNativeAddon(source, target);
  assert.equal(await readFile(target, 'utf8'), 'correct workspace ABI');
  await writeFile(target, 'wrong staged ABI');
  await copyNativeAddon(source, target);
  assert.equal(await readFile(target, 'utf8'), 'correct workspace ABI');
});
