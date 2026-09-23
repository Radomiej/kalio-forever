import { spawn } from 'node:child_process';

export interface CodexConfiguredMcpServer {
  id: string;
  transport:
    | { type: 'stdio'; command: string }
    | { type: 'http'; url: string };
}

export function buildCodexSpawnSpec(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec: string = process.env.ComSpec ?? 'cmd.exe',
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) {
    return { command, args };
  }

  return {
    command: comSpec,
    args: ['/d', '/s', '/c', command, ...args].map((argument, index) => (
      index < 3 ? argument : quoteWindowsCmdArgument(argument)
    )),
    windowsVerbatimArguments: true,
  };
}

export function buildCodexAppServerArgs(
  disabledFeatures: string[] = ['multi_agent'],
  inheritConfiguredMcp = process.env['KALIO_CODEX_INHERIT_MCP']?.trim().toLowerCase() === 'true',
  disabledMcpServers: CodexConfiguredMcpServer[] = [],
): string[] {
  const mcpOverrides = inheritConfiguredMcp
    ? []
    : disabledMcpServers.flatMap((server) => ['-c', buildDisabledMcpOverride(server)]);
  return [
    'app-server',
    '--stdio',
    ...mcpOverrides,
    ...disabledFeatures.flatMap((feature) => ['--disable', feature]),
  ];
}

export async function listConfiguredCodexMcpServers(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<CodexConfiguredMcpServer[]> {
  const spawnSpec = buildCodexSpawnSpec(command, ['mcp', 'list', '--json']);
  return new Promise((resolve, reject) => {
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      windowsHide: true,
      windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Unable to inspect Codex MCP configuration (exit ${code ?? 'null'}).`));
        return;
      }
      try {
        resolve(parseConfiguredCodexMcpServers(stdout));
      } catch (error: unknown) {
        reject(error);
      }
    });
  });
}

export function parseConfiguredCodexMcpServers(output: string): CodexConfiguredMcpServer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('Codex MCP configuration output was not valid JSON.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Codex MCP configuration output was not an array.');
  }

  const servers: CodexConfiguredMcpServer[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry) || entry['enabled'] !== true) continue;
    const id = readNonEmptyString(entry['name']);
    if (!id) throw new Error('An enabled Codex MCP server had no valid name.');

    const transport = entry['transport'];
    if (isRecord(transport)) {
      const command = readNonEmptyString(transport['command']);
      if (command) {
        servers.push({ id, transport: { type: 'stdio', command } });
        continue;
      }

      const url = readNonEmptyString(transport['url']);
      if (url) {
        servers.push({ id, transport: { type: 'http', url } });
        continue;
      }
    }

    throw new Error(`Codex MCP server ${JSON.stringify(id)} has no supported transport identity.`);
  }

  return servers;
}

function buildDisabledMcpOverride(server: CodexConfiguredMcpServer): string {
  const identity = server.transport.type === 'stdio'
    ? `command=${JSON.stringify(server.transport.command)}`
    : `url=${JSON.stringify(server.transport.url)}`;
  return `mcp_servers.${JSON.stringify(server.id)}={${identity},enabled=false}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function quoteWindowsCmdArgument(value: string): string {
  const escaped = value
    .replace(/%/g, '%%')
    .replace(/"/g, '\\"');
  return /[\s"&|<>^()]/.test(value) ? `"${escaped}"` : escaped;
}
