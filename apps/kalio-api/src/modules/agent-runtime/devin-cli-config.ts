import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import type { McpServer } from '@agentclientprotocol/sdk';
import { DEFAULT_DEVIN_NATIVE_TOOLS_POLICY, type DevinNativeToolsPolicy } from './devin-native-tools';

const execFileAsync = promisify(execFile);

export interface DevinCliConfigHandle {
  path: string;
  cwd: string;
  suppressMcpServers: (names: readonly string[]) => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * Devin CLI 3000.x reads MCP servers from its config at process startup, but
 * does not reliably apply the session/new mcpServers list. Keep the project
 * overlay ephemeral and scoped to one ACP host so a Kalio session does not
 * need to mutate the user's or target project's Devin configuration.
 */
export async function createDevinCliConfig(
  model: string,
  mcpServers: readonly McpServer[],
  nativePolicy: DevinNativeToolsPolicy = DEFAULT_DEVIN_NATIVE_TOOLS_POLICY,
  onAllocated?: (handle: DevinCliConfigHandle) => void,
): Promise<DevinCliConfigHandle> {
  const directory = await mkdtemp(join(tmpdir(), 'kalio-devin-acp-'));
  const cwd = join(directory, 'workspace');
  const configDirectory = join(cwd, '.devin');
  const path = join(configDirectory, 'config.local.json');
  let writeConfig!: (names: readonly string[]) => Promise<void>;
  const handle: DevinCliConfigHandle = {
    path, cwd, suppressMcpServers: names => writeConfig(names),
    // Windows can briefly retain cwd/file handles even after the child closes.
    cleanup: () => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
  try {
    onAllocated?.(handle);
    await mkdir(configDirectory, { recursive: true });
    // Devin discovers project-scoped config by walking up to a valid .git/.jj
    // root. Keep that discovery inside the ephemeral host directory rather than
    // the user's project or global Devin configuration.
    await execFileAsync('git', ['init', '--quiet', cwd], { windowsHide: true });
    const mcpConfig = Object.fromEntries(mcpServers.map((server) => [server.name, serializeMcpServer(server)]));
    const dedicatedMcpPath = join(configDirectory, 'mcp_config.local.json');
    // The Kalio host must not import another client's MCP/rules/skills by default.
    // Native user-wide Devin MCP entries are a separate inheritance boundary.
    const read_config_from = {
      cursor: false, windsurf: false, claude: false,
      copilot: false, opencode: false, zed: false,
    };
    // Read-only tools normally bypass ACP permission callbacks. Enforce disabled
    // categories in Devin itself; enabled categories must still request approval.
    const groups = [
      { enabled: nativePolicy.filesystem, tools: ['read', 'grep', 'glob', 'edit', 'write'] },
      { enabled: nativePolicy.terminal, tools: ['exec'] },
      { enabled: nativePolicy.web, tools: ['webfetch', 'web_search'] },
    ];
    const permissions = {
      deny: groups.filter(group => !group.enabled).flatMap(group => group.tools),
      ask: groups.filter(group => group.enabled).flatMap(group => group.tools),
    };
    writeConfig = async (names: readonly string[]): Promise<void> => {
      const disabled = Object.fromEntries(names.filter(name => !Object.hasOwn(mcpConfig, name)).map(name => [name, {
        command: process.execPath, args: ['-e', 'process.exit(0)'], disabled: true,
      }]));
      const servers = { ...disabled, ...mcpConfig };
      const writes = await Promise.allSettled([
        writeFile(path, JSON.stringify({ version: 1, agent: { model }, read_config_from, permissions, mcpServers: servers }, null, 2), { encoding: 'utf8', mode: 0o600 }),
        writeFile(dedicatedMcpPath, JSON.stringify({ mcpServers: servers }, null, 2), { encoding: 'utf8', mode: 0o600 }),
      ]);
      const failed = writes.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason;
    };
    await writeConfig([]);
    return handle;
  } catch (error) {
    // An adopting host owns rollback; standalone callers retain it if cleanup fails.
    if (!onAllocated) {
      try { await handle.cleanup(); }
      catch (cleanupError) {
        throw Object.assign(new AggregateError([error, cleanupError], 'Devin CLI config preparation and cleanup failed.'), { config: handle });
      }
    }
    throw error;
  }
}

function serializeMcpServer(server: McpServer): Record<string, unknown> {
  if ('command' in server) {
    return {
      command: server.command,
      args: server.args,
      env: Object.fromEntries(server.env.map((entry) => [entry.name, entry.value])),
    };
  }
  if (server.type === 'http' || server.type === 'sse') {
    return {
      transport: server.type,
      url: server.url,
      headers: Object.fromEntries(server.headers.map((entry) => [entry.name, entry.value])),
    };
  }
  throw new Error(`Devin CLI config does not support ACP MCP transport: ${server.type}.`);
}
