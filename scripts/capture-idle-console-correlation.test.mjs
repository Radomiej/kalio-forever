import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseProcessCapture } from './capture-idle-console-correlation.mjs';

test('parses complete capture after readiness banner', () => {
  const snapshot = { samples: 2, starts: [{ pid: 5, parentPid: 3, name: 'powershell.exe' }] };
  assert.deepEqual(parseProcessCapture(`PROCESS_SNAPSHOT_READY\n${JSON.stringify(snapshot)}`), snapshot);
});
test('rejects missing or truncated JSON rather than returning an empty capture', () => {
  assert.throws(() => parseProcessCapture('PROCESS_SNAPSHOT_READY'), /no JSON snapshot/);
  assert.throws(() => parseProcessCapture('{"samples":2'), SyntaxError);
});
test('rejects malformed rows and missing sample metadata', () => {
  for (const snapshot of [{ starts: [] }, { samples: 2, starts: [null] },
    { samples: 2, starts: [{ pid: '5', parentPid: 3, name: 'powershell.exe' }] }]) {
    assert.throws(() => parseProcessCapture(JSON.stringify(snapshot)), /Invalid process snapshot/);
  }
});

const script = fileURLToPath(new URL('./capture-idle-console-correlation.mjs', import.meta.url));
for (const duration of ['0', '-1', '61', 'NaN', '1.5']) {
  test(`rejects duration ${duration} before starting observers`, () => {
    const result = spawnSync(process.execPath, [script, duration],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Duration must be 1–60 seconds/);
    assert.equal(result.stdout, '');
  });
}
