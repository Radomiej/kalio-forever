import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDevinCliConfig } from './devin-cli-config';

const executable = process.env['DEVIN_CONFIG_PROBE_EXECUTABLE'];
const execFileAsync = promisify(execFile);

it.skipIf(!executable)('diagnostic: main config override preserves inherited MCP catalog visibility', async () => {
  const config = await createDevinCliConfig('swe-2', [{
    name: 'kalio-isolation-probe', command: process.execPath,
    args: ['-e', 'process.exit(0)'], env: [],
  }]);
  try {
    const observations: Array<{ scopedProbe: boolean; inheritedSerena: boolean; inheritedContext7: boolean }> = [];
    for (const customConfig of [false, true]) {
      const { stdout } = await execFileAsync(executable!, [
        ...(customConfig ? ['--config', config.path] : []), 'mcp', 'list',
      ], { cwd: config.cwd, windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024 });
      // Never print raw CLI output: configured server details can contain secrets.
      const observation = {
        customConfig, scopedProbe: stdout.includes('kalio-isolation-probe'),
        inheritedSerena: stdout.includes('serena'), inheritedContext7: stdout.includes('context7'),
      };
      console.info('MCP isolation metadata', observation);
      expect(observation.scopedProbe).toBe(true);
      observations.push({ scopedProbe: observation.scopedProbe,
        inheritedSerena: observation.inheritedSerena, inheritedContext7: observation.inheritedContext7 });
    }
    // Catalog visibility is not execution: disabled global entries can remain listed.
    // Compare override behavior without requiring machine-specific global servers.
    expect(observations[1]).toEqual(observations[0]);
  } finally {
    await config.cleanup();
  }
}, 40000);

it.skipIf(!executable)('diagnostic: local disabled overrides do not require global config changes', async () => {
  const config = await createDevinCliConfig('swe-2', [{
    name: 'kalio-isolation-probe', command: process.execPath,
    args: ['-e', 'process.exit(0)'], env: [],
  }]);
  try {
    const localPath = join(config.cwd, '.devin', 'mcp_config.local.json');
    const fixture = JSON.parse(await readFile(localPath, 'utf8')) as { mcpServers: Record<string, unknown> };
    for (const name of ['serena', 'context7']) fixture.mcpServers[name] = {
      command: process.execPath, args: ['-e', 'process.exit(0)'], disabled: true,
    };
    await writeFile(localPath, JSON.stringify(fixture), { mode: 0o600 });
    const local = JSON.parse(await readFile(join(config.cwd, '.devin', 'mcp_config.local.json'), 'utf8')) as {
      mcpServers: Record<string, { disabled?: boolean }>;
    };
    expect(local.mcpServers['serena']?.disabled).toBe(true);
    expect(local.mcpServers['context7']?.disabled).toBe(true);
    const { stdout } = await execFileAsync(executable!, ['mcp', 'list'], {
      cwd: config.cwd, windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024,
    });
    const catalog = ['serena', 'context7'].map((name) => ({
      name, rows: stdout.split('\n').filter((line) => line.includes(name)).map((line) => ({
        disabledMarker: /disabled/i.test(line), enabledMarker: /enabled/i.test(line),
        startsWithName: line.trimStart().startsWith(name),
        firstTokenIsName: line.trim().split(/\s+/)[0] === name,
        maskedPrefix: line.slice(0, line.indexOf(name)).replace(/[a-zA-Z0-9]+/g, 'WORD'),
        maskedSuffix: line.slice(line.indexOf(name) + name.length, line.indexOf(name) + name.length + 8).replace(/[a-zA-Z0-9]+/g, 'WORD'),
      })),
    }));
    console.info('Disabled catalog metadata', JSON.stringify(catalog));
    for (const server of catalog) expect(server.rows.some(row => row.disabledMarker)).toBe(true);
  } finally {
    await config.cleanup();
  }
}, 40000);
