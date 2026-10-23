import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('snapshot monitor captures a 400ms child and its real parent without CIM',
  { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
    const monitor = spawn('powershell.exe', ['-NoProfile', '-File',
      fileURLToPath(new URL('./measure-process-snapshots.ps1', import.meta.url)), '-Seconds', '3'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let child;
    monitor.stderr.on('data', chunk => { stderr += chunk; });
    const completion = new Promise((resolve, reject) => {
      monitor.once('error', reject);
      monitor.once('close', code => resolve(code));
    });
    try {
      await new Promise((resolve, reject) => {
        monitor.stdout.on('data', chunk => {
          stdout += chunk;
          if (stdout.includes('PROCESS_SNAPSHOT_READY')) resolve();
        });
        completion.then(() => reject(new Error(`Monitor ended before readiness: ${stderr}`)), reject);
      });
      child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400)'],
        { windowsHide: true, stdio: 'ignore' });
      const code = await completion;
      assert.equal(code, 0, stderr);
      const result = JSON.parse(stdout.slice(stdout.indexOf('{')));
      const captured = result.starts.find(row => row.pid === child.pid);
      assert.ok(captured, '400ms child must be captured after readiness');
      assert.equal(captured.parentPid, process.pid);
      assert.match(captured.name, /node\.exe$/i);
      assert.ok(result.samples > 1);
      assert.ok(result.maxSampleGapMs > 0);
      assert.deepEqual(Object.keys(captured).sort(), ['name', 'observedAtUtc', 'parentPid', 'pid']);
    } finally {
      if (monitor.exitCode === null) monitor.kill();
      if (child && child.exitCode === null) child.kill();
    }
  });
