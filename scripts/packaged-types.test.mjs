import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageRuntimeTypes } from './stage-runtime-types.mjs';

const apiRoot = fileURLToPath(new URL('../apps/kalio-api/', import.meta.url));
const require = createRequire(new URL('../apps/kalio-api/package.json', import.meta.url));

function compileConsumer() {
  const { swcDefaultsFactory } = require('@nestjs/cli/lib/compiler/defaults/swc-defaults');
  const ts = require('typescript');
  const config = ts.readConfigFile(`${apiRoot}/tsconfig.json`, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, apiRoot);
  const nest = JSON.parse(readFileSync(`${apiRoot}/nest-cli.json`, 'utf8'));
  const { swcOptions } = swcDefaultsFactory(parsed.options, nest);
  const { code } = require('@swc/core').transformSync(
    "export { DECISION_SETTINGS } from '@kalio/types';",
    { ...swcOptions, filename: `${apiRoot}/src/common/decision-settings.module.ts` },
  );
  return code;
}

test('API SWC output preserves the portable shared package import', () => {
  const code = compileConsumer();
  assert.match(code, /require\(["']@kalio\/types["']\)/);
  assert.doesNotMatch(code, /packages[\\/]@kalio/);
});

for (const script of ['build-runtime-package.mjs', 'tauri-prepare.mjs']) {
  test(`${script} restores shared runtime package after flat install`, () => {
    const source = readFileSync(new URL(script, import.meta.url), 'utf8');
    assert.ok(/await installFlatRuntimeDependencies\(\);\s*await stageRuntimeTypes\(root, serverRoot\);/.test(source));
  });
}

test('relocated server loads the built shared package without workspace links', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kalio-packaged-types-'));
  try {
    const serverRoot = join(temporaryRoot, 'server');
    await stageRuntimeTypes(fileURLToPath(new URL('../', import.meta.url)), serverRoot);
    const consumer = join(serverRoot, 'dist', 'common', 'consumer.cjs');
    await mkdir(join(serverRoot, 'dist', 'common'), { recursive: true });
    await writeFile(consumer, compileConsumer());
    const isolatedRequire = createRequire(consumer);
    assert.ok(isolatedRequire.resolve('@kalio/types').startsWith(serverRoot));
    assert.equal(isolatedRequire(consumer).DECISION_SETTINGS, require('@kalio/types').DECISION_SETTINGS);
    await assert.rejects(stageRuntimeTypes(join(temporaryRoot, 'missing-build'), serverRoot), { code: 'ENOENT' });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
