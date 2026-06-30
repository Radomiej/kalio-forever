import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { MCPPolicy, ToolMeta } from '@kalio/types';
import { PersonaToolPicker, PersonaToolBadges } from './PersonaToolPicker';

const TOOL_FIXTURE: ToolMeta[] = [
  {
    name: 'vfs_read_file',
    domain: 'vfs',
    description: 'Read files from the virtual filesystem.',
    parameters: {},
    requiresConfirmation: false,
  },
  {
    name: 'fs_search',
    domain: 'file_system',
    description: 'Search the filesystem.',
    parameters: {},
    requiresConfirmation: true,
  },
  {
    name: 'run_subagent',
    domain: 'subagent',
    description: 'Spawn a subagent.',
    parameters: {},
    requiresConfirmation: false,
  },
  {
    name: 'spawn_cli_agent',
    domain: 'cli_agent',
    description: 'Start a durable CLI child.',
    parameters: {},
    requiresConfirmation: false,
  },
  {
    name: 'run_sub_agentflow',
    domain: 'agent_workflow',
    description: 'Run a child workflow.',
    parameters: {},
    requiresConfirmation: false,
  },
  {
    name: 'escalate',
    domain: 'security_audit',
    description: 'Escalate an issue for review.',
    parameters: {},
    requiresConfirmation: false,
  },
  {
    name: 'mcp_toml::web_search',
    domain: 'mcp',
    description: 'Search the web through MCP.',
    serverKey: 'toml::web',
    aliases: ['mcp_web_search'],
    parameters: {},
    requiresConfirmation: false,
  },
];
const LEGACY_MCP_TOOL = 'mcp_web_search';
const CANONICAL_MCP_TOOL = 'mcp_toml::web_search';

function installFetchMock(payload: ToolMeta[], failOnce = false) {
  const fetchMock = vi.fn(async () => {
    if (failOnce) {
      failOnce = false;
      throw new Error('tool catalog unavailable');
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function ToolPickerHarness({ initialSelected, initialPolicy }: { initialSelected: string[]; initialPolicy: MCPPolicy }) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [mcpPolicy, setMcpPolicy] = useState<MCPPolicy>(initialPolicy);

  return (
    <>
      <PersonaToolPicker
        selected={selected}
        mcpPolicy={mcpPolicy}
        onChange={(tools, policy) => {
          setSelected(tools);
          setMcpPolicy(policy);
        }}
      />
      <output data-testid="selected-tools">{selected.join(',')}</output>
    </>
  );
}

describe('PersonaToolPicker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('groups native tools, supports global selection controls, and switches MCP policy when needed', async () => {
    installFetchMock(TOOL_FIXTURE);

    render(<ToolPickerHarness initialSelected={['vfs_read_file']} initialPolicy="allow_all" />);

    await screen.findByTestId('group-toggle-vfs');
    expect(screen.getByText('VFS')).toBeInTheDocument();
    expect(screen.getByText('Filesystem')).toBeInTheDocument();
    expect(screen.getByText('Subagents')).toBeInTheDocument();
    expect(screen.getByText('CLI Agents')).toBeInTheDocument();
    expect(screen.getByText('Agent Workflows')).toBeInTheDocument();
    expect(screen.getByText('Security & Audit')).toBeInTheDocument();
    expect(screen.getByText('confirm')).toBeInTheDocument();
    expect(screen.getByText('MCP Tools')).toBeInTheDocument();
    expect(screen.getByText('1 available')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tools-enable-all'));

    await waitFor(() => {
      expect(screen.getByTestId('group-toggle-vfs')).toBeChecked();
      expect(screen.getByTestId('group-toggle-fs')).toBeChecked();
      expect(screen.getByTestId('group-toggle-subagents')).toBeChecked();
      expect(screen.getByTestId('group-toggle-cli-agents')).toBeChecked();
      expect(screen.getByTestId('group-toggle-agent-workflows')).toBeChecked();
      expect(screen.getByTestId('group-toggle-security-audit')).toBeChecked();
    });

    fireEvent.click(screen.getByTestId('tools-disable-all'));

    await waitFor(() => {
      expect(screen.getByTestId('group-toggle-vfs')).not.toBeChecked();
      expect(screen.getByTestId('group-toggle-fs')).not.toBeChecked();
      expect(screen.getByTestId('group-toggle-subagents')).not.toBeChecked();
      expect(screen.getByTestId('group-toggle-cli-agents')).not.toBeChecked();
      expect(screen.getByTestId('group-toggle-agent-workflows')).not.toBeChecked();
      expect(screen.getByTestId('group-toggle-security-audit')).not.toBeChecked();
    });

    fireEvent.click(screen.getByTestId('mcp-policy-allow_list'));
    await screen.findByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`);
    fireEvent.click(screen.getByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`));

    await waitFor(() => {
      expect(screen.getByTestId('mcp-policy-allow_list').querySelector('input')).toBeChecked();
      expect(screen.getByText(/1\/1/)).toBeInTheDocument();
    });
  }, 15_000);

  it('shows a load error and retries the catalog request', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchMock(TOOL_FIXTURE, true);

    render(<PersonaToolPicker selected={[]} mcpPolicy="allow_all" onChange={() => {}} />);

    expect(await screen.findByText('Unable to load tools.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByTestId('group-toggle-vfs')).toBeInTheDocument();
  });

  it('removes MCP tools from the allow-list when switching away from allow_list', async () => {
    const user = userEvent.setup();
    installFetchMock(TOOL_FIXTURE);

    render(<ToolPickerHarness initialSelected={['vfs_read_file', CANONICAL_MCP_TOOL]} initialPolicy="allow_list" />);

    await screen.findByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`);
    expect(screen.getByTestId('mcp-policy-allow_list').querySelector('input')).toBeChecked();
    expect(screen.getByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`).querySelector('input')).toBeChecked();

    await user.click(screen.getByTestId('mcp-policy-allow_all'));
    await user.click(screen.getByTestId('mcp-policy-allow_list'));

    await waitFor(() => {
      expect(screen.getByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`).querySelector('input')).not.toBeChecked();
    });
  });

  it('keeps MCP allow-list selections when native All and None controls change native tools', async () => {
    const user = userEvent.setup();
    installFetchMock(TOOL_FIXTURE);

    render(
      <ToolPickerHarness
        initialSelected={['vfs_read_file', CANONICAL_MCP_TOOL]}
        initialPolicy="allow_list"
      />,
    );

    await screen.findByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`);

    await user.click(screen.getByTestId('tools-enable-all'));

    await waitFor(() => {
      expect(screen.getByTestId('selected-tools')).toHaveTextContent(CANONICAL_MCP_TOOL);
      expect(screen.getByTestId('selected-tools')).toHaveTextContent('spawn_cli_agent');
    });

    await user.click(screen.getByTestId('tools-disable-all'));

    await waitFor(() => {
      expect(screen.getByTestId('selected-tools')).toHaveTextContent(CANONICAL_MCP_TOOL);
      expect(screen.getByTestId('selected-tools')).not.toHaveTextContent('vfs_read_file');
      expect(screen.getByTestId('selected-tools')).not.toHaveTextContent('spawn_cli_agent');
    });
  });

  it('accepts legacy MCP allow-list names and normalizes them to canonical identifiers', async () => {
    const user = userEvent.setup();
    installFetchMock(TOOL_FIXTURE);

    render(
      <ToolPickerHarness
        initialSelected={[LEGACY_MCP_TOOL]}
        initialPolicy="allow_list"
      />,
    );

    await screen.findByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`);
    expect(screen.getByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`).querySelector('input')).toBeChecked();
    await waitFor(() => {
      expect(screen.getByTestId('selected-tools')).toHaveTextContent(CANONICAL_MCP_TOOL);
      expect(screen.getByTestId('selected-tools')).not.toHaveTextContent(LEGACY_MCP_TOOL);
    });

    await user.click(screen.getByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`));

    await waitFor(() => {
      expect(screen.getByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`).querySelector('input')).not.toBeChecked();
    });
  });

  it('normalizes legacy MCP entries without clearing native selections from persisted allow-lists', async () => {
    installFetchMock(TOOL_FIXTURE);

    render(
      <ToolPickerHarness
        initialSelected={['vfs_read_file', LEGACY_MCP_TOOL]}
        initialPolicy="allow_list"
      />,
    );

    await screen.findByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`);

    expect(screen.getByTestId('tool-toggle-vfs_read_file').querySelector('input')).toBeChecked();
    expect(screen.getByTestId(`tool-toggle-${CANONICAL_MCP_TOOL}`).querySelector('input')).toBeChecked();
    await waitFor(() => {
      expect(screen.getByTestId('selected-tools')).toHaveTextContent('vfs_read_file');
      expect(screen.getByTestId('selected-tools')).toHaveTextContent(CANONICAL_MCP_TOOL);
      expect(screen.getByTestId('selected-tools')).not.toHaveTextContent(LEGACY_MCP_TOOL);
    });
  });

  it('shows read-only badges for grouped tools and MCP policy summaries', () => {
    render(<PersonaToolBadges tools={['vfs_read_file', 'vfs_write_file', LEGACY_MCP_TOOL]} mcpPolicy="allow_list" />);

    expect(screen.getByTitle('vfs_read_file, vfs_write_file')).toBeInTheDocument();
    expect(screen.getByTitle('mcp_web_search')).toHaveTextContent('MCP:1');
  });

  it('shows the empty state when only deny-all is available', () => {
    render(<PersonaToolBadges tools={[]} mcpPolicy="deny_all" />);

    expect(screen.getByText('No tools enabled')).toBeInTheDocument();
  });

  it('renders the no tools state when the catalog has no native tools', async () => {
    installFetchMock([
      {
        name: CANONICAL_MCP_TOOL,
        domain: 'mcp',
        description: 'Search the web through MCP.',
        serverKey: 'toml::web',
        aliases: [LEGACY_MCP_TOOL],
        parameters: {},
        requiresConfirmation: false,
      },
    ]);

    render(<PersonaToolPicker selected={[]} mcpPolicy="deny_all" onChange={() => {}} />);

    expect(await screen.findByText('No tools available')).toBeInTheDocument();
  });
});
