import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CLIAgentPanel } from './CLIAgentPanel';
import type { CLIAgentAdapterInfo, CLIAgentConfig } from '@kalio/types';

const ADAPTER: CLIAgentAdapterInfo = {
  id: 'copilot',
  displayName: 'GitHub Copilot',
  installUrl: 'https://example.com/install',
  available: true,
  version: '1.0.0',
};

const CONFIG: CLIAgentConfig = {
  enabled: true,
  cliPath: '',
  timeoutMs: 600000,
  maxOutputChars: 16000,
  extraArgs: [],
};

function installFetchMock(adapter: CLIAgentAdapterInfo = ADAPTER, config: CLIAgentConfig = CONFIG) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts?: RequestInit) => {
      const method = opts?.method?.toUpperCase() ?? 'GET';

      if (method === 'GET' && url === '/api/cli-agents') {
        return new Response(JSON.stringify([adapter]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url === `/api/cli-agents/${adapter.id}/config`) {
        return new Response(JSON.stringify(config), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'PUT' && url === `/api/cli-agents/${adapter.id}/config`) {
        return new Response(String(opts?.body ?? '{}'), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(null, { status: 404 });
    }),
  );
}

function getPutBody(agentId = ADAPTER.id): CLIAgentConfig {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
  const putCall = calls.find(([url, opts]) => url === `/api/cli-agents/${agentId}/config` && opts?.method === 'PUT');
  expect(putCall).toBeDefined();
  return JSON.parse((putCall![1]?.body as string) ?? '{}') as CLIAgentConfig;
}

describe('CLIAgentPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installFetchMock();
  });

  it('renders Codex with a codex-specific CLI path hint', async () => {
    installFetchMock({
      id: 'codex',
      displayName: 'Codex CLI',
      installUrl: 'https://example.com/codex',
      available: true,
      version: '0.130.0',
    });

    render(<CLIAgentPanel />);

    await screen.findByText('Codex CLI');
    await waitFor(() => {
      expect(screen.getAllByRole('textbox')[0]).toHaveAttribute('placeholder', 'e.g. /usr/local/bin/codex');
    });
  });

  it('does not serialize an empty timeout as 0 (REGRESSION)', async () => {
    const user = userEvent.setup();
    render(<CLIAgentPanel />);

    await screen.findByText('GitHub Copilot');
    const [timeoutInput] = await screen.findAllByRole('spinbutton');
    fireEvent.change(timeoutInput, { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody().timeoutMs).toBe(600000);
    });
  });

  it('does not serialize an empty maxOutputChars as 0 (REGRESSION)', async () => {
    const user = userEvent.setup();
    render(<CLIAgentPanel />);

    await screen.findByText('GitHub Copilot');
    const [, maxOutputInput] = await screen.findAllByRole('spinbutton');
    fireEvent.change(maxOutputInput, { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody().maxOutputChars).toBe(16000);
    });
  });

  it('trims whitespace-only cliPath before save (REGRESSION)', async () => {
    const user = userEvent.setup();
    render(<CLIAgentPanel />);

    const cliPathInput = await screen.findByPlaceholderText('e.g. /usr/local/bin/copilot');
    fireEvent.change(cliPathInput, { target: { value: '   ' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody().cliPath ?? '').toBe('');
    });
  });

  it('trims whitespace-only extraArgs lines before save (REGRESSION)', async () => {
    const user = userEvent.setup();
    render(<CLIAgentPanel />);

    const extraArgsInput = await screen.findByPlaceholderText('e.g. --no-auto-commit');
    fireEvent.change(extraArgsInput, { target: { value: '\n  \n--flag\n  --other  ' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody().extraArgs).toEqual(['--flag', '--other']);
    });
  });

  it('does not serialize a timeout below the UI minimum (REGRESSION)', async () => {
    const user = userEvent.setup();
    render(<CLIAgentPanel />);

    await screen.findByText('GitHub Copilot');
    const [timeoutInput] = await screen.findAllByRole('spinbutton');
    fireEvent.change(timeoutInput, { target: { value: '-1' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody().timeoutMs).toBeGreaterThanOrEqual(10000);
    });
  });

  it('does not serialize maxOutputChars below the UI minimum (REGRESSION)', async () => {
    const user = userEvent.setup();
    render(<CLIAgentPanel />);

    await screen.findByText('GitHub Copilot');
    const [, maxOutputInput] = await screen.findAllByRole('spinbutton');
    fireEvent.change(maxOutputInput, { target: { value: '1' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody().maxOutputChars).toBeGreaterThanOrEqual(1000);
    });
  });
});