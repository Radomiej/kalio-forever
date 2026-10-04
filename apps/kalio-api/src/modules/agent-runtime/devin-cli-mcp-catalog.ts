import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import type { DevinCliConfigHandle } from './devin-cli-config';

const execFileAsync = promisify(execFile);
const startupLogger = new Logger('DevinMcpStartup');
const failure = (): Error => new Error('Devin MCP catalog format is unsupported or incomplete; host startup blocked.');

export interface DevinMcpCatalogEntry { name: string; disabled: boolean }

/** Version-specific CLI text boundary. Never include raw output in errors/logs. */
export function parseDevinMcpCatalog(output: string): DevinMcpCatalogEntry[] {
  const lines = output.replace(/\r/g, '').split('\n').filter(line => line.trim());
  if (lines.shift() !== 'Configured MCP servers:') throw failure();
  const entries: DevinMcpCatalogEntry[] = [];
  const names = new Set<string>();
  let hasEndpoint = false;
  for (const line of lines) {
    const row = /^ {2}([•✗]) ([A-Za-z0-9][A-Za-z0-9._-]{0,127})( {2}\(disabled\))?$/.exec(line);
    if (row) {
      if (entries.length && !hasEndpoint) throw failure();
      const name = row[2]!;
      if (names.has(name) || (row[1] === '✗') !== Boolean(row[3])) throw failure();
      names.add(name);
      entries.push({ name, disabled: row[1] === '✗' });
      hasEndpoint = false;
    } else if (/^ {4}(Command|URL): \S.*$/.test(line) && entries.length && !hasEndpoint) {
      hasEndpoint = true;
    } else {
      throw failure();
    }
  }
  if (!entries.length || !hasEndpoint) throw failure();
  return entries;
}

/** Suppress discovered inherited names, not a promise of global hooks isolation. */
export async function suppressInheritedDevinMcp(
  executable: string, config: DevinCliConfigHandle, allowedNames: readonly string[],
): Promise<number> {
  const read = async (stage: 'version' | 'discover' | 'verify', args: string[]): Promise<string> => {
    const startedAt = Date.now();
    try {
      const pending = execFileAsync(executable, args, {
        cwd: config.cwd, windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024,
      });
      startupLogger.log(`stage=${stage} phase=start parentPid=${process.pid} pid=${pending.child?.pid ?? 'unavailable'} windowsHide=true`);
      const { stdout, stderr } = await pending;
      if (stderr.trim()) throw failure();
      startupLogger.log(`stage=${stage} phase=success durationMs=${Date.now() - startedAt}`);
      return stdout;
    } catch {
      startupLogger.log(`stage=${stage} phase=failure durationMs=${Date.now() - startedAt}`);
      // CLI errors may embed commands, URLs or secrets; preserve only the boundary.
      throw new Error('Devin MCP configuration check failed; host startup blocked.');
    }
  };
  if (!/^devin 3000\.11\.1(?:\s|$)/.test((await read('version', ['--version'])).trim())) {
    throw new Error('Devin MCP configuration check requires supported CLI 3000.11.1; host startup blocked.');
  }
  const allowed = new Set(allowedNames);
  const catalog = parseDevinMcpCatalog(await read('discover', ['mcp', 'list']));
  const suppressed = catalog.filter(entry => !allowed.has(entry.name)).map(entry => entry.name);
  await config.suppressMcpServers(suppressed);
  const checked = parseDevinMcpCatalog(await read('verify', ['mcp', 'list']));
  if (checked.some(entry => entry.disabled === allowed.has(entry.name))
    || allowedNames.some(name => !checked.some(entry => entry.name === name && !entry.disabled))
    || suppressed.some(name => !checked.some(entry => entry.name === name && entry.disabled))) {
    throw new Error('Devin MCP local suppression did not take effect; host startup blocked.');
  }
  return suppressed.length;
}
