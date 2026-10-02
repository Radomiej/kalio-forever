import { describe, expect, it } from 'vitest';
import {
  buildCodexAppServerArgs,
  parseConfiguredCodexMcpServers,
} from './codex-app-server-process';

describe('Codex App Server process configuration', () => {
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

  it('escapes transport identities without forwarding args, environment, or headers', () => {
    expect(buildCodexAppServerArgs([], false, [
      {
        id: 'quoted"server',
        transport: { type: 'stdio', command: 'C:\\Tools\\codex helper.cmd' },
      },
    ])).toEqual([
      'app-server',
      '--stdio',
      '-c',
      'mcp_servers."quoted\\"server"={command="C:\\\\Tools\\\\codex helper.cmd",enabled=false}',
    ]);
  });
});
