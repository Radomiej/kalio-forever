import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const installer = resolve('scripts/install-macos.sh');
test('macOS installer rejects invalid arguments before touching disk', () => {
  for (const args of [['--unknown'], ['--install-root'], ['--repository']]) {
    const result = spawnSync('bash', [installer, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown argument|Missing value/);
  }
});

test('macOS install and update preserve data and serialize operations', () => {
  const root = mkdtempSync(join(tmpdir(), 'kalio mac test '));
  try {
    const bin = join(root, 'tools');
    mkdirSync(bin);
    const stub = (name, body) => {
      writeFileSync(join(bin, name), '#!/bin/bash\nset -e\n' + body + '\n', { mode: 0o755 });
    };
    stub('uname', 'echo Darwin');
    stub('pnpm', 'if [ "${1:-}" = --version ]; then echo 9.15.0; else echo "pnpm $*" >> "$TEST_LOG"; fi');
    stub('node', 'echo "node $*" >> "$TEST_LOG"');
    stub('git', `echo "git $*" >> "$TEST_LOG"
if [ "$1" = clone ]; then
  for destination in "$@"; do :; done
  mkdir -p "$destination/scripts"
  cp "$TEST_CLI" "$destination/scripts/macos-cli.sh"
fi`);
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH,
      TEST_LOG: join(root, 'operations'), TEST_CLI: resolve('scripts/macos-cli.sh') };
    const target = join(root, 'installed app');
    const run = (file, args = []) => spawnSync('bash', [file, ...args], { env, encoding: 'utf8' });
    assert.equal(run(installer, ['--install-root', target]).status, 0);
    const key = readFileSync(join(target, 'data/kalio.env'), 'utf8');
    assert.match(key, /^CREDENTIALS_MASTER_KEY=[a-f0-9]{64}\n$/);
    writeFileSync(join(target, 'data/sentinel'), 'user data');
    const cli = join(target, 'bin/kalio');
    assert.equal(run(cli, ['start']).status, 0);
    assert.equal(run(cli, ['update']).status, 0);
    assert.equal(readFileSync(join(target, 'data/kalio.env'), 'utf8'), key);
    assert.equal(readFileSync(join(target, 'data/sentinel'), 'utf8'), 'user data');
    const log = readFileSync(env.TEST_LOG, 'utf8');
    assert.match(log, /git merge --ff-only @\{upstream\}/);
    assert.match(log, /--profile prod/);
    mkdirSync(join(target, '.operation-lock'));
    assert.equal(run(cli, ['update']).status, 1);
    assert.equal(run(cli, ['stop']).status, 1);
    assert.equal(run(installer, ['--install-root', target]).status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
