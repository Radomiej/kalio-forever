import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./watch-console-windows.ps1', import.meta.url), 'utf8');

test('console capture is bounded and cleans up its event hook', () => {
  assert.match(source, /ValidateRange\(1, 300\)/);
  assert.match(source, /SetWinEventHook\(0x8000, 0x8003/);
  assert.match(source, /PeekMessage\(out message/);
  assert.match(source, /finally \{[\s\S]*DestroyWindow\(control\);[\s\S]*UnhookWinEvent\(handle\); GC.KeepAlive\(callback\);/);
});

test('console capture excludes titles, command lines and process mutation', () => {
  assert.doesNotMatch(source, /GetWindowText|CommandLine|Start-Process|Stop-Process|taskkill|Get-CimInstance/);
  assert.match(source, /GetWindowThreadProcessId/);
  assert.match(source, /ConsoleWindowClass/);
  assert.match(source, /CASCADIA_HOSTING_WINDOW_CLASS/);
});
