import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./observe-qa-startup.mjs', import.meta.url), 'utf8');

test('both startup observers cover a 90-second probe tail before cleanup', () => {
  assert.match(source, /const captureSeconds = 90;/);
  assert.equal((source.match(/'-Seconds', String\(captureSeconds\)/g) ?? []).length, 2);
  assert.match(source, /\(captureSeconds \+ 30\) \* 1000/);
  const sampler = readFileSync(new URL('./measure-process-snapshots.ps1', import.meta.url), 'utf8');
  assert.match(sampler, /ValidateRange\(1, 300\)/);
});

test('capture waits for both ready signals and retains full raw evidence', () => {
  assert.ok(source.indexOf('await Promise.all([windowMonitor.ready, processMonitor.ready])')
    < source.indexOf("const launcher = launch(process.execPath"));
  assert.match(source, /writeFileSync\(outputPath, JSON.stringify\(capture, null, 2\)\)/);
  assert.match(source, /windowsHide: true/);
  assert.doesNotMatch(source, /stack-manager.mjs', '(?:stop|reset)'|--rebuild/);
});
