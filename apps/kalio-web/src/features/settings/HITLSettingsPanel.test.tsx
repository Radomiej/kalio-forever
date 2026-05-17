import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Persona } from '@kalio/types';
import { HITLSettingsPanel } from './HITLSettingsPanel';

const PERSONAS: Persona[] = [
  {
    id: 'reviewer-persona',
    name: 'Reviewer',
    systemPrompt: 'Review tool approvals.',
    model: 'mock',
    allowedTools: [],
    skillIds: [],
    mcpPolicy: 'allow_all',
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'ops-persona',
    name: 'Ops',
    systemPrompt: 'Approve safe ops work.',
    model: 'mock',
    allowedTools: [],
    skillIds: [],
    mcpPolicy: 'allow_all',
    createdAt: 2,
    updatedAt: 2,
  },
];

function installFetchMock(initialConfig = { mode: 'manual', autoPersonaId: null as string | null }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts?: RequestInit) => {
      const method = opts?.method?.toUpperCase() ?? 'GET';

      if (method === 'GET' && url === '/api/hitl/config') {
        return new Response(JSON.stringify(initialConfig), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url === '/api/personas') {
        return new Response(JSON.stringify(PERSONAS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'PUT' && url === '/api/hitl/config') {
        return new Response(String(opts?.body ?? '{}'), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(null, { status: 404 });
    }),
  );
}

function getPutBody(): { mode: string; autoPersonaId: string | null } | null {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
  const putCall = calls.find(([url, opts]) => url === '/api/hitl/config' && opts?.method === 'PUT');
  if (!putCall) {
    return null;
  }
  return JSON.parse(String(putCall[1]?.body ?? '{}')) as { mode: string; autoPersonaId: string | null };
}

describe('HITLSettingsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installFetchMock();
  });

  it('loads the saved config and persists auto mode with a selected persona', async () => {
    installFetchMock({ mode: 'manual', autoPersonaId: null });
    const user = userEvent.setup();
    render(<HITLSettingsPanel />);

    await screen.findByText('HITL Approvals');
    await user.click(screen.getByLabelText('Auto persona'));
    fireEvent.change(screen.getByLabelText('Approval persona'), { target: { value: 'ops-persona' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody()).toEqual({ mode: 'auto', autoPersonaId: 'ops-persona' });
    });
  });

  it('blocks saving auto mode when no persona is selected', async () => {
    const user = userEvent.setup();
    render(<HITLSettingsPanel />);

    await screen.findByText('HITL Approvals');
    await user.click(screen.getByLabelText('Auto persona'));
    fireEvent.change(screen.getByLabelText('Approval persona'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Choose a persona for auto approvals.')).toBeInTheDocument();
    });
    expect(getPutBody()).toBeNull();
  });
});