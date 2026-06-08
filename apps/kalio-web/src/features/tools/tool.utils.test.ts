import { describe, expect, it } from 'vitest';
import type { ToolMeta } from '@kalio/types';
import { groupToolsByPrefix } from './tool.utils';

function makeTool(name: string): ToolMeta {
  return {
    name,
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
});
