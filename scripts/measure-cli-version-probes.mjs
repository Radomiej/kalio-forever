import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Exercise the built probe service only. No tasks, config writes or QA restart.
const require = createRequire(new URL('../apps/kalio-api/package.json', import.meta.url));
const { CLIAgentProbeService } = require('./dist/modules/cli-agent/cli-agent-probe.service.js');
const adapters = ['copilot', 'gemini', 'claude-code', 'codex'].map((name) => {
  const module = require(`./dist/modules/cli-agent/adapters/${name}.adapter.js`);
  return new (Object.values(module).find(value => typeof value === 'function' && value.name.endsWith('Adapter')))();
});
const monitor = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
  '-File', 'scripts/measure-process-snapshots.ps1', '-Seconds', '10'],
{ windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
let errors = '';
let markReady;
let failReady;
const ready = new Promise((resolve, reject) => { markReady = resolve; failReady = reject; });
const completed = new Promise((resolve, reject) => {
  monitor.stdout.on('data', chunk => { output += chunk; if (output.includes('PROCESS_SNAPSHOT_READY')) markReady(); });
  monitor.stderr.on('data', chunk => { errors += chunk; });
  monitor.once('error', error => { failReady(error); reject(error); });
  monitor.once('close', code => {
    if (!output.includes('PROCESS_SNAPSHOT_READY')) failReady(new Error(errors || 'Monitor was not ready'));
    resolve(code);
  });
});
completed.catch(error => { console.error(error.message); });
try {
  await ready;
  const audit = [];
  const config = { getConfig: async id => {
    const response = await fetch(`http://127.0.0.1:3316/api/cli-agents/${id}/config`);
    if (!response.ok) throw new Error(`QA config unavailable for ${id}: ${response.status}`);
    return response.json();
  } };
  const service = new CLIAgentProbeService(config, ...adapters, { recordInvocation: async event => { audit.push(event); } });
  const versions = await service.refreshAllProbes();
  const code = await completed;
  if (code !== 0) throw new Error(errors || `Monitor exit ${code}`);
  const samples = JSON.parse(output.slice(output.indexOf('\n') + 1));
  const ids = new Set([process.pid]);
  let changed;
  do {
    changed = false;
    for (const row of samples.starts) if (ids.has(row.parentPid) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; }
  } while (changed);
  const descendants = samples.starts.filter(row => ids.has(row.pid) && row.pid !== monitor.pid);
  const directory = resolve('.tmp', 'probe-captures');
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `probe-${Date.now()}-${process.pid}.json`);
  writeFileSync(path, JSON.stringify({ rootPid: process.pid, versions, audit, samples }, null, 2));
  console.log(JSON.stringify({ path, versions, descendants, samples: samples.samples, maxGapMs: samples.maxSampleGapMs }));
  if (versions.some(version => !version.available)) process.exitCode = 1;
} finally { if (monitor.exitCode === null) monitor.kill(); }
