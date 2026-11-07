import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HitlConfig, Persona } from '@kalio/types';
import { HITLSettingsPanel } from './HITLSettingsPanel';
import { DEFAULT_TEST_PERSONA_AVATAR } from '../../test/personaFixtures';

// Auth transport is verified separately; these fixtures cover the HITL UI contract.
vi.mock('./decision-settings.transport', () => ({
  decisionSettingsRequest: vi.fn((path: string, init?: RequestInit) => fetch(path, init)),
}));

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

function installFetchMock(initialConfig: HitlConfig = {
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
  const terminalConfig: HitlConfig = {
    mode: 'jev', autoPersonaId: null, unattendedFallback: 'pause', representativePersonaId: null,
    notificationChannel: 'none', externalPolicyEnabled: false, externalPolicyPersonaId: null,
    raAppApprovalTimeoutMs: 600_000,
    rules: [{ id: 'saved-deny', kind: 'tool', name: 'terminal_exec', decision: 'deny', argumentsContains: '--production' }],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    installFetchMock();
  });

  it('defaults legacy terminal approvals to manual without saving the draft', async () => {
    installFetchMock(terminalConfig);
    render(<HITLSettingsPanel />);
    const select = await screen.findByRole('combobox', { name: 'Approval authority' });
    expect(select).toHaveValue('human');
    expect(select).toHaveAccessibleDescription('Deny and ask-user rules take precedence. Uncertainty or provider failure requires manual approval.');
    expect(screen.getByRole('option', { name: 'Always ask me' })).toHaveValue('human');
    expect(screen.getByRole('option', { name: 'Decision model' })).toHaveValue('decision_model');
    expect(getPutBody()).toBeNull();
  });

  it('saves human-first Jev handoff with an explicit two-minute timeout', async () => {
    installFetchMock(terminalConfig);
    const user = userEvent.setup(); render(<HITLSettingsPanel />);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Approval authority' }), 'human_then_decision');
    const timeout = screen.getByRole('combobox', { name: 'Time before Jev takes over' });
    expect(screen.getByRole('option', { name: 'No timeout' })).toHaveValue('0');
    await user.selectOptions(timeout, '120000');
    expect(getPutBody()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('HITL settings saved.');
    expect(getPutBody()).toMatchObject({ confirmationAuthority: 'human_then_decision', humanReviewTimeoutMs: 120000 });
    expect(timeout).toHaveValue('120000');
  });

  it('hydrates saved project-read terminal approvals', async () => {
    installFetchMock({ ...terminalConfig, confirmationAuthority: 'decision_model' });
    render(<HITLSettingsPanel />);
    expect(await screen.findByRole('combobox', { name: 'Approval authority' })).toHaveValue('decision_model');
    expect(getPutBody()).toBeNull();
  });

  it.each(['human', 'decision_model'] as const)('saves terminal approval draft %s while preserving rules', async (confirmationAuthority) => {
    installFetchMock({ ...terminalConfig, confirmationAuthority: confirmationAuthority === 'human' ? 'decision_model' : 'human' });
    const user = userEvent.setup();
    render(<HITLSettingsPanel />);
    const select = await screen.findByRole('combobox', { name: 'Approval authority' });
    await user.selectOptions(select, confirmationAuthority);
    expect(getPutBody()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('HITL settings saved.');
    expect(getPutBody()).toMatchObject({ mode: 'jev', confirmationAuthority, rules: terminalConfig.rules });
    expect(select).toHaveValue(confirmationAuthority);
  });

  it('does not expose terminal approvals while config is loading', () => {
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => undefined));
    render(<HITLSettingsPanel />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Approval authority' })).not.toBeInTheDocument();
    expect(getPutBody()).toBeNull();
  });

  it('hydrates the terminal approval value returned by PUT instead of retaining the draft', async () => {
    installFetchMock(terminalConfig);
    const user = userEvent.setup();
    render(<HITLSettingsPanel />);
    const select = await screen.findByRole('combobox', { name: 'Approval authority' });
    await user.selectOptions(select, 'decision_model');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...terminalConfig, confirmationAuthority: 'human' }), { status: 200 }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('HITL settings saved.');
    expect(getPutBody()).toMatchObject({ confirmationAuthority: 'decision_model' });
    expect(select).toHaveValue('human');
  });

  it('disables terminal approvals while saving and retains the draft after failure', async () => {
    installFetchMock(terminalConfig);
    const user = userEvent.setup();
    render(<HITLSettingsPanel />);
    const select = await screen.findByRole('combobox', { name: 'Approval authority' });
    await user.selectOptions(select, 'decision_model');
    let rejectSave!: (reason: Error) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectSave = reject; }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(select).toBeDisabled();
    rejectSave(new Error('Save failed'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    expect(select).toBeEnabled();
    expect(select).toHaveValue('decision_model');
    expect(screen.queryByText('HITL settings saved.')).not.toBeInTheDocument();
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
        confirmationAuthority: 'human',
        humanReviewTimeoutMs: 60_000,
        autoPersonaId: 'ops-persona',
        jevApprovalThreshold: 0.95,
        jevInstructions: '',
        jevFallbackToPersona: false,
        rules: [],
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
        confirmationAuthority: 'human',
        humanReviewTimeoutMs: 60_000,
        jevApprovalThreshold: 0.95,
        jevInstructions: '',
        jevFallbackToPersona: false,
        rules: [],
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

  it('keeps manual active until Jev is explicitly saved with the .95 default', async () => {
    const user = userEvent.setup(); render(<HITLSettingsPanel />);
    await screen.findByText('HITL Approvals');
    expect(screen.getByLabelText('Manual')).toBeChecked();
    expect(getPutBody()).toBeNull();
    await user.click(screen.getByLabelText('Jev typed decisions'));
    expect(screen.getByLabelText('Jev approval threshold')).toHaveValue(0.95);
    expect(getPutBody()).toBeNull();
    fireEvent.change(screen.getByLabelText('Jev approval instructions'), { target: { value: 'Ask for uncertain actions.' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('HITL settings saved.');
    expect(getPutBody()).toMatchObject({ mode: 'jev', jevApprovalThreshold: 0.95, jevInstructions: 'Ask for uncertain actions.' });
    expect(getPutBody()).not.toHaveProperty('jevCredentialId');
  });

  it.each(['0.5', '0', '1.01', ''])('blocks invalid Jev threshold %s', async (value) => {
    const user = userEvent.setup(); render(<HITLSettingsPanel />);
    await screen.findByText('HITL Approvals');
    await user.click(screen.getByLabelText('Jev typed decisions'));
    fireEvent.change(screen.getByLabelText('Jev approval threshold'), { target: { value } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('greater than 0.5 and at most 1');
    expect(getPutBody()).toBeNull();
  });

  it('accepts threshold 1', async () => {
    const user = userEvent.setup(); render(<HITLSettingsPanel />);
    await screen.findByText('HITL Approvals');
    await user.click(screen.getByLabelText('Jev typed decisions'));
    fireEvent.change(screen.getByLabelText('Jev approval threshold'), { target: { value: '1' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('HITL settings saved.');
    expect(getPutBody()).toMatchObject({ mode: 'jev', jevApprovalThreshold: 1 });
  });

  it('blocks saving defaults on failed load and permits retry', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Cannot load HITL'));
    render(<HITLSettingsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot load HITL');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(getPutBody()).toBeNull();
  });

  it('blocks oversized Jev instructions even when supplied by a saved config', async () => {
    const user = userEvent.setup(); render(<HITLSettingsPanel />);
    await screen.findByText('HITL Approvals');
    await user.click(screen.getByLabelText('Jev typed decisions'));
    fireEvent.change(screen.getByLabelText('Jev approval instructions'), { target: { value: 'x'.repeat(2001) } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at most 2000');
    expect(getPutBody()).toBeNull();
  });

  it('keeps the Jev draft after a failed save', async () => {
    const user = userEvent.setup(); render(<HITLSettingsPanel />);
    await screen.findByText('HITL Approvals');
    await user.click(screen.getByLabelText('Jev typed decisions'));
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Authentication required', { status: 401 }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('401');
    expect(screen.getByLabelText('Jev typed decisions')).toBeChecked();
    expect(screen.queryByText('HITL settings saved.')).not.toBeInTheDocument();
  });

  it('saves a scoped deny rule without enabling Jev or allow behavior', async () => {
    const user = userEvent.setup(); render(<HITLSettingsPanel />);
    await screen.findByText('HITL Approvals');
    await user.click(screen.getByRole('button', { name: 'Add deny rule' }));
    expect(getPutBody()).toBeNull();
    expect(screen.getByLabelText('Rule 1 decision')).toHaveValue('deny');
    fireEvent.change(screen.getByLabelText('Rule 1 name'), { target: { value: 'terminal_exec' } });
    fireEvent.change(screen.getByLabelText('Rule 1 executable'), { target: { value: 'powershell.exe' } });
    fireEvent.change(screen.getByLabelText('Rule 1 argument substring'), { target: { value: '--production' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('HITL settings saved.');
    expect(getPutBody()).toMatchObject({ mode: 'manual', rules: [{
      id: expect.any(String), kind: 'tool', name: 'terminal_exec', decision: 'deny', executable: 'powershell.exe', argumentsContains: '--production',
    }] });
  });

  it('rejects an empty rule scope and removes the rule without sending a request', async () => {
    const user = userEvent.setup(); render(<HITLSettingsPanel />);
    await screen.findByText('HITL Approvals');
    await user.click(screen.getByRole('button', { name: 'Add deny rule' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('require an operation name');
    expect(getPutBody()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove rule 1' }));
    expect(screen.getByText('No hard rules configured.')).toBeInTheDocument();
    expect(getPutBody()).toBeNull();
  });

  it('hydrates saved Jev and hard rules and preserves readonly Allow rules', async () => {
    const rules = [{ id: 'saved-rule', kind: 'tool', name: 'vfs_read', decision: 'allow' }];
    const savedConfig = {
      mode: 'jev', autoPersonaId: null, unattendedFallback: 'pause', representativePersonaId: null,
      notificationChannel: 'none', externalPolicyEnabled: false, externalPolicyPersonaId: null,
      raAppApprovalTimeoutMs: 600_000, jevApprovalThreshold: 0.98, jevInstructions: 'Saved policy',
      jevFallbackToPersona: false, rules,
    };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(savedConfig), { status: 200 }));
    const user = userEvent.setup(); render(<HITLSettingsPanel />);
    await screen.findByText('HITL Approvals');
    expect(screen.getByLabelText('Jev typed decisions')).toBeChecked();
    expect(screen.getByLabelText('Jev approval threshold')).toHaveValue(0.98);
    expect(screen.getByLabelText('Jev approval instructions')).toHaveValue('Saved policy');
    expect(screen.getByText(/Existing Allow rule/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Rule 1 decision')).not.toBeInTheDocument();
    expect(getPutBody()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('HITL settings saved.');
    expect(getPutBody()).toMatchObject({ mode: 'jev', jevApprovalThreshold: 0.98, rules });
  });
});

it('saves explicit Ollama mode with no persona fallback or probability controls', async () => {
  installFetchMock();
  render(<HITLSettingsPanel />);
  const option = await screen.findByRole('radio', { name: 'Ollama local verdicts' });
  fireEvent.click(option);
  expect(option).toBeChecked();
  expect(screen.getByText(/Only eligible read-only operations/)).toHaveTextContent('Protected operations and errors require manual approval');
  expect(screen.queryByLabelText('Jev approval threshold')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Jev approval instructions')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Approval persona')).toBeDisabled();
  expect(getPutBody()).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('HITL settings saved.');
  expect(getPutBody()).toMatchObject({ mode: 'ollama', jevFallbackToPersona: false });
  expect(getPutBody()).not.toHaveProperty('autoPersonaId');
  expect(getPutBody()).not.toHaveProperty('jevApprovalThreshold');
  expect(getPutBody()).not.toHaveProperty('jevInstructions');
});
