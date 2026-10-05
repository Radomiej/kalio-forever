import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

test('console events identify visibility, window identity and original event time', () => {
  assert.match(source, /extern bool IsWindowVisible\(IntPtr hwnd\)/);
  assert.match(source, /hwnd=.+hwnd\.ToInt64\(\)/);
  assert.match(source, /visible=.+IsWindowVisible\(hwnd\)/);
  assert.match(source, /eventTickMs=.+time/);
  assert.match(source, /visibility is sampled at callback delivery/);
});

test('real window capture reports events whose windows disappear before class lookup', {
  skip: process.platform !== 'win32',
}, () => {
  const output = execFileSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', fileURLToPath(new URL('./watch-console-windows.ps1', import.meta.url)),
    '-Seconds', '1', '-SelfTest',
  ], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  const summary = output.match(/WINDOW_EVENT_HOOK_FINISHED records=(\d+) unclassified=(\d+)/);
  assert.ok(summary, 'capture must explicitly disclose unclassified events');
  assert.ok(Number(summary[2]) > 0, 'destroyed hidden fixture must leave an unclassified event');
  assert.equal(Number(summary[2]), output.split('\n').filter((line) => line.includes('class=unavailable')).length);
  assert.match(output, /class=Static/);
});

test('window monitor attributes a vanished hidden control to its live event thread',
  { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
    const monitor = spawn('powershell.exe', ['-NoProfile', '-File',
      fileURLToPath(new URL('./watch-console-windows.ps1', import.meta.url)),
      '-Seconds', '1', '-SelfTest'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    monitor.stdout.on('data', chunk => { stdout += chunk; });
    monitor.stderr.on('data', chunk => { stderr += chunk; });
    try {
      const code = await new Promise((resolve, reject) => {
        monitor.once('error', reject);
        monitor.once('close', resolve);
      });
      assert.equal(code, 0, stderr);
      const vanished = stdout.split(/\r?\n/).filter(row => row.includes('class=unavailable'));
      assert.ok(vanished.length > 0, 'destroy-before-delivery control must exercise attribution');
      assert.ok(vanished.some(row => row.includes(`pid=${monitor.pid} `)
        && row.includes('pidSource=event-thread')), 'vanished control must retain process attribution');
      assert.ok(vanished.some(row => row.includes(`pid=${monitor.pid} `)
        && /processName=powershell\.exe(?:\s|$)/i.test(row)),
      'event callback must resolve the process name without relying on a later process snapshot');
      assert.match(stdout, /WINDOW_EVENT_HOOK_FINISHED/);
    } finally {
      if (monitor.exitCode === null) monitor.kill();
    }
  });
