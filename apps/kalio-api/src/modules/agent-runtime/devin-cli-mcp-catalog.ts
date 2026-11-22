import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import type { DevinCliConfigHandle } from './devin-cli-config';
import { captureExecutionCurrent, type ExecutionCurrentCheck } from './devin-cli-acp.execution-guard';

const execFileAsync = promisify(execFile);
const startupLogger = new Logger('DevinMcpStartup');
const failure = (): Error => new Error('Devin MCP catalog format is unsupported or incomplete; host startup blocked.');

export interface DevinMcpCatalogEntry { name: string; disabled: boolean }

/** Version-specific CLI text boundary. Never include raw output in errors/logs. */
export function parseDevinMcpCatalog(output: string, format: 'legacy' | 'with-source' = 'legacy'): DevinMcpCatalogEntry[] {
  const lines = output.replace(/\r/g, '').split('\n').filter(line => line.trim());
  const hasSourceColumn = format === 'with-source';
  if (lines.shift() !== (hasSourceColumn ? 'Configured MCP servers' : 'Configured MCP servers:')) throw failure();
  const entries: DevinMcpCatalogEntry[] = [];
  const names = new Set<string>();
  let hasEndpoint = false;
  let hasSource = false;
  const complete = () => hasEndpoint && (!hasSourceColumn || hasSource);
  for (const line of lines) {
    const row = /^ {2}([•✗]) ([A-Za-z0-9][A-Za-z0-9._-]{0,127})( {2}\(disabled\))?$/.exec(line);
    if (row) {
      if (entries.length && !complete()) throw failure();
      const name = row[2]!;
      if (names.has(name) || (row[1] === '✗') !== Boolean(row[3])) throw failure();
      names.add(name);
      entries.push({ name, disabled: row[1] === '✗' });
      hasEndpoint = false;
      hasSource = false;
    } else if (/^ {4}(Command|URL): \S.*$/.test(line) && entries.length && !hasEndpoint) {
      hasEndpoint = true;
    } else if (hasSourceColumn && hasEndpoint && !hasSource && /^ {4}Source: \S.*$/.test(line)) {
      hasSource = true;
    } else {
      throw failure();
    }
  }
  if (!entries.length || !complete()) throw failure();
  return entries;
}

/** Suppress discovered inherited names, not a promise of global hooks isolation. */
export async function suppressInheritedDevinMcp(
  executable: string, config: DevinCliConfigHandle, allowedNames: readonly string[], assertExecutionCurrent?: ExecutionCurrentCheck,
): Promise<number> {
  const check = captureExecutionCurrent(assertExecutionCurrent); check?.();
  const read = async (stage: 'version' | 'discover' | 'verify', args: string[]): Promise<string> => {
    const startedAt = Date.now();
    try {
      check?.();
      const pending = execFileAsync(executable, args, {
        cwd: config.cwd, windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024,
      });
      startupLogger.log(`stage=${stage} phase=start parentPid=${process.pid} pid=${pending.child?.pid ?? 'unavailable'} windowsHide=true`);
      const { stdout, stderr } = await pending;
      check?.();
      if (stderr.trim()) throw failure();
      startupLogger.log(`stage=${stage} phase=success durationMs=${Date.now() - startedAt}`);
      return stdout;
    } catch {
      startupLogger.log(`stage=${stage} phase=failure durationMs=${Date.now() - startedAt}`);
      // CLI errors may embed commands, URLs or secrets; preserve only the boundary.
      throw new Error('Devin MCP configuration check failed; host startup blocked.');
    }
  };
  const version = /^devin (3000\.11\.(?:1|234))(?:\s|$)/.exec((await read('version', ['--version'])).trim())?.[1];
  if (!version) throw new Error('Devin MCP configuration check requires CLI 3000.11.1 or 3000.11.234; host startup blocked.');
  const format = version === '3000.11.234' ? 'with-source' : 'legacy';
  const allowed = new Set(allowedNames);
  const catalog = parseDevinMcpCatalog(await read('discover', ['mcp', 'list']), format);
  const suppressed = catalog.filter(entry => !allowed.has(entry.name)).map(entry => entry.name);
  check?.();
  await config.suppressMcpServers(suppressed);
  check?.();
  const checked = parseDevinMcpCatalog(await read('verify', ['mcp', 'list']), format);
  if (checked.some(entry => entry.disabled === allowed.has(entry.name))
    || allowedNames.some(name => !checked.some(entry => entry.name === name && !entry.disabled))
    || suppressed.some(name => !checked.some(entry => entry.name === name && entry.disabled))) {
    throw new Error('Devin MCP local suppression did not take effect; host startup blocked.');
  }
  return suppressed.length;
}
