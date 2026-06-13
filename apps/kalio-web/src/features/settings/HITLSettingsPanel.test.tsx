import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Persona } from '@kalio/types';
import { HITLSettingsPanel } from './HITLSettingsPanel';
import { DEFAULT_TEST_PERSONA_AVATAR } from '../../test/personaFixtures';

const PERSONAS: Persona[] = [
  {
    id: 'reviewer-persona',
    name: 'Reviewer',
    systemPrompt: 'Review tool approvals.',
    model: 'mock',
    allowedTools: [],
    skillIds: [],
    mcpPolicy: 'allow_all',
    ...DEFAULT_TEST_PERSONA_AVATAR,
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
    ...DEFAULT_TEST_PERSONA_AVATAR,
    createdAt: 2,
    updatedAt: 2,
  },
];

function installFetchMock(initialConfig = {
  mode: 'manual',
  autoPersonaId: null as string | null,
  unattendedFallback: 'pause' as 'pause' | 'representative',
  representativePersonaId: null as string | null,
  notificationChannel: 'none' as 'none' | 'telegram',
  externalPolicyEnabled: false,
  externalPolicyPersonaId: null as string | null,
  raAppApprovalTimeoutMs: 600_000,
}) {
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

function getPutBody(): Record<string, unknown> | null {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
  const putCall = calls.find(([url, opts]) => url === '/api/hitl/config' && opts?.method === 'PUT');
  if (!putCall) {
    return null;
  }
  return JSON.parse(String(putCall[1]?.body ?? '{}')) as Record<string, unknown>;
}

describe('HITLSettingsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installFetchMock();
  });

  it('loads the saved config and persists auto mode with a selected persona', async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<HITLSettingsPanel />);

    await screen.findByText('HITL Approvals');
    await user.click(screen.getByLabelText('Auto persona'));
    fireEvent.change(screen.getByLabelText('Approval persona'), { target: { value: 'ops-persona' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody()).toEqual({
        mode: 'auto',
        autoPersonaId: 'ops-persona',
        unattendedFallback: 'pause',
        representativePersonaId: null,
        notificationChannel: 'none',
        externalPolicyEnabled: false,
        externalPolicyPersonaId: null,
        raAppApprovalTimeoutMs: 600_000,
      });
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

  it('does not send stale autoPersonaId when saving manual mode', async () => {
    installFetchMock({
      mode: 'auto',
      autoPersonaId: 'ops-persona',
      unattendedFallback: 'pause',
      representativePersonaId: null,
      notificationChannel: 'none',
      externalPolicyEnabled: false,
      externalPolicyPersonaId: null,
      raAppApprovalTimeoutMs: 600_000,
    });
    const user = userEvent.setup();
    render(<HITLSettingsPanel />);

    await screen.findByText('HITL Approvals');
    await user.click(screen.getByLabelText('Manual'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody()).toEqual({
        mode: 'manual',
        unattendedFallback: 'pause',
        representativePersonaId: null,
        notificationChannel: 'none',
        externalPolicyEnabled: false,
        externalPolicyPersonaId: null,
        raAppApprovalTimeoutMs: 600_000,
      });
    });
  });

  it('persists external HITL policy enablement with a persona', async () => {
    const user = userEvent.setup();
    render(<HITLSettingsPanel />);

    await screen.findByText('HITL Approvals');
    await user.click(screen.getByLabelText('Enable external HITL policy'));
    fireEvent.change(screen.getByLabelText('External policy persona'), { target: { value: 'reviewer-persona' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody()).toMatchObject({
        mode: 'manual',
        externalPolicyEnabled: true,
        externalPolicyPersonaId: 'reviewer-persona',
      });
    });
  });

  it('persists representative unattended fallback with notification channel', async () => {
    const user = userEvent.setup();
    render(<HITLSettingsPanel />);

    await screen.findByText('HITL Approvals');
    await user.click(screen.getByLabelText('Representative on timeout'));
    fireEvent.change(screen.getByLabelText('Representative persona'), { target: { value: 'ops-persona' } });
    fireEvent.change(screen.getByLabelText('Notification channel'), { target: { value: 'telegram' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody()).toMatchObject({
        mode: 'manual',
        unattendedFallback: 'representative',
        representativePersonaId: 'ops-persona',
        notificationChannel: 'telegram',
      });
    });
  });

  it('blocks representative fallback when no persona is selected', async () => {
    const user = userEvent.setup();
    render(<HITLSettingsPanel />);

    await screen.findByText('HITL Approvals');
    await user.click(screen.getByLabelText('Representative on timeout'));
    fireEvent.change(screen.getByLabelText('Representative persona'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Choose a representative persona for unattended approvals.')).toBeInTheDocument();
    });
    expect(getPutBody()).toBeNull();
  });

  it('persists RA-App approval timeout in minutes', async () => {
    const user = userEvent.setup();
    render(<HITLSettingsPanel />);

    await screen.findByText('HITL Approvals');
    fireEvent.change(screen.getByLabelText('RA-App approval timeout minutes'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPutBody()).toMatchObject({
        mode: 'manual',
        raAppApprovalTimeoutMs: 120_000,
      });
    });
  });
});
