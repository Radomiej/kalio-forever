import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDevinCliConfig } from './devin-cli-config';

describe('Devin CLI ephemeral config', () => {
  it('serializes the scoped stdio bridge and cleans the temporary config', async () => {
    const config = await createDevinCliConfig('glm-5-2', [{
      name: 'kalio-runtime',
      command: process.execPath,
      args: ['kalio-mcp-bridge-stdio.js'],
      env: [
        { name: 'KALIO_MCP_BRIDGE_SESSION_ID', value: 'session-1' },
        { name: 'KALIO_MCP_BRIDGE_TOOL_NAMES', value: 'fs_list' },
      ],
    }]);
    try {
      const parsed = JSON.parse(await readFile(config.path, 'utf8')) as {
        agent?: { model?: string };
        mcpServers?: Record<string, { transport?: string; command?: string; args?: string[]; env?: Record<string, string> }>;
      };
      expect(parsed.agent?.model).toBe('glm-5-2');
      expect(parsed.mcpServers?.['kalio-runtime']).toEqual({
        command: process.execPath,
        args: ['kalio-mcp-bridge-stdio.js'],
        env: {
          KALIO_MCP_BRIDGE_SESSION_ID: 'session-1',
          KALIO_MCP_BRIDGE_TOOL_NAMES: 'fs_list',
        },
      });
      expect(config.cwd).toContain('kalio-devin-acp-');
      expect(config.path).toBe(join(config.cwd, '.devin', 'config.local.json'));
      expect((await stat(join(config.cwd, '.git'))).isDirectory()).toBe(true);
      expect((await stat(join(config.cwd, '.git', 'HEAD'))).isFile()).toBe(true);
      expect(await readFile(join(config.cwd, '.devin', 'mcp_config.local.json'), 'utf8')).toContain('kalio-runtime');
    } finally {
      await config.cleanup();
    }
  });
});
