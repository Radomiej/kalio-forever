import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import type { McpServer } from '@agentclientprotocol/sdk';
import type { DevinCliModel } from '@kalio/types';

const execFileAsync = promisify(execFile);

export interface DevinCliConfigHandle {
  path: string;
  cwd: string;
  cleanup: () => Promise<void>;
}

/**
 * Devin CLI 3000.x reads MCP servers from its config at process startup, but
 * does not reliably apply the session/new mcpServers list. Keep the project
 * overlay ephemeral and scoped to one ACP host so a Kalio session does not
 * need to mutate the user's or target project's Devin configuration.
 */
export async function createDevinCliConfig(
  model: DevinCliModel,
  mcpServers: readonly McpServer[],
): Promise<DevinCliConfigHandle> {
  const directory = await mkdtemp(join(tmpdir(), 'kalio-devin-acp-'));
  const cwd = join(directory, 'workspace');
  const configDirectory = join(cwd, '.devin');
  await mkdir(configDirectory, { recursive: true });
  // Devin discovers project-scoped config by walking up to a valid .git/.jj
  // root. Keep that discovery inside the ephemeral host directory rather than
  // the user's project or global Devin configuration.
  await execFileAsync('git', ['init', '--quiet', cwd], { windowsHide: true });
  const mcpConfig = Object.fromEntries(mcpServers.map((server) => [server.name, serializeMcpServer(server)]));
  const path = join(configDirectory, 'config.local.json');
  const dedicatedMcpPath = join(configDirectory, 'mcp_config.local.json');
  await Promise.all([
    writeFile(path, JSON.stringify({ version: 1, agent: { model }, mcpServers: mcpConfig }, null, 2), { encoding: 'utf8', mode: 0o600 }),
    writeFile(dedicatedMcpPath, JSON.stringify({ mcpServers: mcpConfig }, null, 2), { encoding: 'utf8', mode: 0o600 }),
  ]);
  return {
    path,
    cwd,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
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
