import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = () => readFileSync(new URL('./measure-startup-processes.ps1', import.meta.url), 'utf8');

test('startup capture subscribes before announcing readiness and does not require a running root', () => {
  const script = source();
  assert.match(script, /Win32_ProcessStartTrace/);
  assert.ok(script.indexOf('Register-CimIndicationEvent') < script.indexOf('STARTUP_PROCESS_MONITOR_READY'));
  assert.doesNotMatch(script, /RootProcessId|Get-Process/);
});

test('startup capture retains short-lived process identities and drains before unsubscribe', () => {
  const script = source();
  assert.match(script, /ProcessID/);
  assert.match(script, /ParentProcessID/);
  assert.match(script, /ProcessName/);
  assert.match(script, /TIME_CREATED/);
  assert.match(script, /Receive-StartupEvents\s*\r?\n\s*\$endedAt/);
  assert.match(script, /finally[\s\S]*Unregister-Event[\s\S]*Remove-Job/);
});

test('startup capture is bounded and excludes secrets and process mutation', () => {
  const script = source();
  assert.match(script, /ValidateRange\(1, 60\)/);
  assert.doesNotMatch(script, /CommandLine|GetWindowText|Start-Process|Stop-Process|taskkill/);
});
