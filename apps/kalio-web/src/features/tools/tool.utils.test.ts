import { describe, expect, it } from 'vitest';
import type { ToolMeta } from '@kalio/types';
import { groupToolsByPrefix } from './tool.utils';

function makeTool(name: string, domain?: ToolMeta['domain']): ToolMeta {
  return {
    name,
    domain,
    description: `${name} description`,
    parameters: {},
    requiresConfirmation: false,
  };
}

describe('groupToolsByPrefix', () => {
  it('groups tools into the expected buckets in declaration order', () => {
    const result = groupToolsByPrefix([
      makeTool('run_subagent'),
      makeTool('spawn_subagent'),
      makeTool('message_subagent'),
      makeTool('run_cli_agent'),
      makeTool('spawn_cli_agent'),
      makeTool('message_cli_agent'),
      makeTool('get_cli_agent_status'),
      makeTool('stop_cli_agent'),
      makeTool('run_sub_agentflow'),
      makeTool('wait_for'),
      makeTool('escalate'),
      makeTool('vfs_read'),
      makeTool('fs_write'),
      makeTool('kv_get'),
      makeTool('terminal_exec'),
      makeTool('run_raapp'),
      makeTool('design_preview'),
      makeTool('memory_search'),
      makeTool('grep_search'),
      makeTool('web_search'),
      makeTool('list_tools'),
      makeTool('image_generate'),
      makeTool('skill_run'),
      makeTool('persona_list'),
    ]);

    expect(result.map((group) => group.label)).toEqual([
      'Subagents',
      'CLI Agents',
      'Agent Workflows',
      'Security & Audit',
      'Virtual Filesystem',
      'Filesystem',
      'Key-Value Store',
      'Terminal',
      'RAApp',
      'Preview',
      'Memory',
      'Search',
      'Web',
      'Tools',
      'Images',
      'Skills',
      'Persona',
    ]);

    expect(result[0]?.tools.map((tool) => tool.name)).toEqual([
      'run_subagent',
      'spawn_subagent',
      'message_subagent',
    ]);

    expect(result[1]?.tools.map((tool) => tool.name)).toEqual([
      'run_cli_agent',
      'spawn_cli_agent',
      'message_cli_agent',
      'get_cli_agent_status',
      'stop_cli_agent',
    ]);

    expect(result[2]?.tools.map((tool) => tool.name)).toEqual([
      'run_sub_agentflow',
      'wait_for',
    ]);

    expect(result[3]?.tools.map((tool) => tool.name)).toEqual([
      'escalate',
    ]);
  });

  it('puts unmatched tools into the Other bucket', () => {
    const result = groupToolsByPrefix([
      makeTool('custom_tool'),
      makeTool('web_search'),
      makeTool('another_custom_tool'),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ label: 'Web' });
    expect(result[1]).toMatchObject({
      label: 'Other',
      tools: [
        expect.objectContaining({ name: 'custom_tool' }),
        expect.objectContaining({ name: 'another_custom_tool' }),
      ],
    });
  });

  it('does not duplicate a tool across multiple buckets', () => {
    const result = groupToolsByPrefix([
      makeTool('run_cli_agent'),
      makeTool('run_cli_agent'),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('CLI Agents');
    expect(result[0]?.tools).toHaveLength(2);
  });

  it('keeps durable CLI session tools in the CLI Agents bucket', () => {
    const result = groupToolsByPrefix([
      makeTool('spawn_cli_agent'),
      makeTool('message_cli_agent'),
      makeTool('get_cli_agent_status'),
      makeTool('stop_cli_agent'),
      makeTool('custom_tool'),
    ]);

    expect(result[0]).toMatchObject({ label: 'CLI Agents' });
    expect(result[0]?.tools.map((tool) => tool.name)).toEqual([
      'spawn_cli_agent',
      'message_cli_agent',
      'get_cli_agent_status',
      'stop_cli_agent',
    ]);
    expect(result[1]).toMatchObject({ label: 'Other' });
  });

  it('groups MCP tools into a dedicated MCP bucket after native tools', () => {
    const result = groupToolsByPrefix([
      makeTool('web_search'),
      {
        ...makeTool('mcp_toml::docs_search', 'mcp'),
        serverKey: 'toml::docs',
      },
      makeTool('custom_tool'),
    ]);

    expect(result.map((group) => group.label)).toEqual(['Web', 'MCP', 'Other']);
    expect(result[1]?.tools.map((tool) => tool.name)).toEqual(['mcp_toml::docs_search']);
  });

  it('uses MCP serverKey metadata for canonical MCP tools without parsing name prefixes', () => {
    const result = groupToolsByPrefix([
      makeTool('web_search'),
      {
        ...makeTool('mcp_toml::docs_search'),
        serverKey: 'toml::docs',
      },
    ]);

    expect(result.map((group) => group.label)).toEqual(['Web', 'MCP']);
    expect(result[1]?.tools.map((tool) => tool.name)).toEqual(['mcp_toml::docs_search']);
  });

  it('uses typed tool domains instead of native name prefixes for grouping', () => {
    const result = groupToolsByPrefix([
      makeTool('custom_virtual_reader', 'vfs'),
      makeTool('vfs_fake'),
      makeTool('fs_fake'),
      makeTool('mcp_fake'),
    ]);

    expect(result.map((group) => group.label)).toEqual(['Virtual Filesystem', 'Other']);
    expect(result[0]?.tools.map((tool) => tool.name)).toEqual(['custom_virtual_reader']);
    expect(result[1]?.tools.map((tool) => tool.name)).toEqual(['vfs_fake', 'fs_fake', 'mcp_fake']);
  });
});
