import { describe, expect, it } from 'vitest';
import {
  buildCodexAppServerArgs,
  buildCodexSpawnSpec,
  parseConfiguredCodexMcpServers,
} from './codex-app-server-process';

describe('Codex App Server process configuration', () => {
  it.each(['codex.cmd\nwhoami', 'codex.cmd\rwhoami', 'codex.cmd\0'])('rejects unsafe Windows command paths: %j', (command) => {
    expect(() => buildCodexSpawnSpec(command, [], 'win32')).toThrow('NUL or line breaks');
  });

  it.each(['input\nwhoami', 'input\rwhoami', 'input\0', '" & whoami', '" | whoami', '"%PATH%', '"!PATH!'])('rejects unsafe batch shim arguments: %j', (argument) => {
    expect(() => buildCodexSpawnSpec('codex.cmd', [argument], 'win32')).toThrow();
  });

  it('keeps ordinary JSON MCP overrides available for Windows shims', () => {
    const args = buildCodexAppServerArgs([], false, [
      { id: 'local', transport: { type: 'stdio', command: 'C:\\Tools\\node.exe' } },
    ]);
    expect(() => buildCodexSpawnSpec('codex.cmd', args, 'win32')).not.toThrow();
  });
  it('keeps only enabled MCP transport identities from Codex JSON output', () => {
    const output = JSON.stringify([
      {
        name: 'local-tools',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'C:\\Program Files\\nodejs\\node.exe',
          args: ['server.js', '--token', 'secret-value'],
          env: { SECRET: 'secret-value' },
        },
      },
      {
        name: 'remote-tools',
        enabled: true,
        transport: {
          type: 'streamable_http',
          url: 'http://127.0.0.1:36521/mcp',
          http_headers: { Authorization: 'Bearer secret-value' },
        },
      },
      {
        name: 'already-disabled',
        enabled: false,
        transport: { type: 'stdio', command: 'node' },
      },
    ]);

    expect(parseConfiguredCodexMcpServers(output)).toEqual([
      {
        id: 'local-tools',
        transport: { type: 'stdio', command: 'C:\\Program Files\\nodejs\\node.exe' },
      },
      {
        id: 'remote-tools',
        transport: { type: 'http', url: 'http://127.0.0.1:36521/mcp' },
      },
    ]);
  });

  it('rejects an enabled MCP server without a reusable transport identity', () => {
    const output = JSON.stringify([
      { name: 'broken-tools', enabled: true, transport: { type: 'stdio' } },
    ]);

    expect(() => parseConfiguredCodexMcpServers(output)).toThrow(
      'Codex MCP server "broken-tools" has no supported transport identity.',
    );
  });

  it('disables the actual server key rather than creating a key with literal quotes', () => {
    expect(buildCodexAppServerArgs([], false, [
      {
        id: 'local-tools',
        transport: { type: 'stdio', command: 'C:\\Tools\\codex helper.cmd' },
      },
    ])).toEqual([
      'app-server',
      '--stdio',
      '-c',
      'mcp_servers.local-tools={command="C:\\\\Tools\\\\codex helper.cmd",enabled=false}',
    ]);
  });

  it('fails closed when a server ID cannot be addressed by a CLI dotted path', () => {
    expect(() => buildCodexAppServerArgs([], false, [
      { id: 'quoted"server', transport: { type: 'stdio', command: 'node' } },
    ])).toThrow('cannot safely disable');
  });
});
