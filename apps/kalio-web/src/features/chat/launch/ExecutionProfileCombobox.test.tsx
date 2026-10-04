import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionProfile } from '@kalio/types';
import { getDevinCliStatus, resolveDevinCliExecutionProfile, type DevinCliStatus } from '../../../services/apiClient';
import { ExecutionProfileCombobox } from './ExecutionProfileCombobox';
import { getCodexModels, resolveCodexExecutionProfile } from '../../../services/codexModelClient';

vi.mock('../../../services/codexModelClient', () => ({
  getCodexModels: vi.fn().mockResolvedValue(['gpt-5.6']),
  resolveCodexExecutionProfile: vi.fn(),
}));

vi.mock('../../../services/apiClient', () => ({
  getDevinCliStatus: vi.fn().mockResolvedValue({ modelCatalogStatus: 'ready', modelCatalogStale: false, models: [] }),
  resolveDevinCliExecutionProfile: vi.fn(),
}));

function profile(overrides: Partial<ExecutionProfile>): ExecutionProfile {
  return {
    id: 'profile',
    name: 'Profile',
    kind: 'direct-llm',
    provider: 'openai',
    model: 'gpt-4.1',
    approvalMode: 'codex_guard',
    enabled: true,
    capabilitiesVersion: '1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('ExecutionProfileCombobox', () => {
  it('does not advertise unchecked Codex profiles or start discovery without an explicit recheck', async () => {
    vi.mocked(getCodexModels).mockClear().mockResolvedValue(null);
    const saved = profile({ id: 'old', kind: 'codex-app-server', authProfileId: 'account', model: 'gpt-5.4' });
    await act(async () => { render(<ExecutionProfileCombobox profiles={[saved]} value="" onChange={vi.fn()} />); });
    fireEvent.focus(screen.getByRole('combobox', { name: 'Provider and model' }));
    expect(screen.queryByRole('option', { name: /Codex/ })).not.toBeInTheDocument();
    expect(getCodexModels).toHaveBeenCalledTimes(1);
    expect(getCodexModels).toHaveBeenCalledWith('account');
    vi.mocked(getCodexModels).mockResolvedValue(['gpt-6-luna']);
    fireEvent.click(screen.getByRole('button', { name: 'Recheck Codex models' }));
    await screen.findByRole('option', { name: /Codex · gpt-6-luna/ });
    expect(getCodexModels).toHaveBeenLastCalledWith('account', true);
  });
  it('uses only discovered Codex models and resolves a new exact model on its account', async () => {
    vi.mocked(getCodexModels).mockResolvedValue(['gpt-6-luna']);
    vi.mocked(resolveCodexExecutionProfile).mockResolvedValue(profile({ id: 'new-codex', kind: 'codex-app-server', model: 'gpt-6-luna' }));
    const onChange = vi.fn();
    render(<ExecutionProfileCombobox profiles={[profile({ id: 'old', kind: 'codex-app-server', authProfileId: 'account', model: 'gpt-5.4' })]} value="" onChange={onChange} />);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Provider and model' }));
    const option = await screen.findByRole('option', { name: /Codex · gpt-6-luna/ });
    expect(screen.queryByRole('option', { name: /gpt-5.4/ })).not.toBeInTheDocument();
    fireEvent.click(option);
    await waitFor(() => expect(resolveCodexExecutionProfile).toHaveBeenCalledWith('account', 'gpt-6-luna'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('new-codex'));
  });
  beforeEach(() => {
    vi.mocked(getCodexModels).mockResolvedValue(['gpt-5.6']);
    vi.mocked(getDevinCliStatus).mockResolvedValue({
      executable: 'devin.exe', version: 'test', authenticated: true, acp: true, probeChecked: true,
      models: [], modelCatalogStatus: 'ready', modelCatalogStale: false, modelCatalogDiscoveredAt: 1, hostCount: 0, hosts: [],
    });
  });
  it('selects the exact searched model with Enter before discovered hybrids', async () => {
    vi.mocked(getDevinCliStatus).mockResolvedValue({
      executable: 'devin.exe', version: 'test', authenticated: true, acp: true, probeChecked: true,
      models: ['fusion-gpt-sidekick-swe-2-high', 'swe-2', 'swe-2-high'],
      modelCatalogStatus: 'ready', modelCatalogStale: false, modelCatalogDiscoveredAt: 1, hostCount: 0, hosts: [],
    });
    const onChange = vi.fn();
    render(<ExecutionProfileCombobox profiles={[
      profile({ id: 'exact', kind: 'devin-cli-acp', model: 'swe-2' }),
    ]} value="" onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Provider and model' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '  SWE-2  ' } });
    await screen.findByRole('option', { name: /fusion-gpt-sidekick/ });
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Devin CLI · swe-2');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('exact');
  });

  it('ranks exact direct-provider matches above unrelated preferred-runtime substring matches', async () => {
    const onChange = vi.fn();
    await act(async () => { render(<ExecutionProfileCombobox profiles={[
      profile({ id: 'hybrid', kind: 'devin-cli-acp', model: 'fusion-gpt-4.1' }),
      profile({ id: 'direct', provider: 'openai', model: 'gpt-4.1' }),
    ]} value="" onChange={onChange} />); });
    const input = screen.getByRole('combobox', { name: 'Provider and model' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'gpt-4.1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('direct');
  });

  it('searches by provider/model and ranks Devin and Codex before direct LLM profiles', async () => {
    const onChange = vi.fn();
    render(
      <ExecutionProfileCombobox
        profiles={[
          profile({ id: 'openai', name: 'OpenAI', provider: 'openai', model: 'gpt-4.1' }),
          profile({ id: 'codex', name: 'Codex', kind: 'codex-app-server', provider: undefined, model: 'gpt-5.6' }),
          profile({ id: 'devin', name: 'Devin SWE-2', kind: 'devin-cli-acp', provider: undefined, model: 'swe-2' }),
        ]}
        value=""
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Provider and model' });
    fireEvent.focus(input);
    await screen.findByRole('option', { name: /Codex · gpt-5.6/ });
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.querySelector('.font-medium')?.textContent)).toEqual([
      'Devin CLI · swe-2',
      'Codex · gpt-5.6',
      'openai · gpt-4.1',
    ]);

    fireEvent.change(input, { target: { value: 'swe' } });
    const result = within(screen.getByRole('listbox')).getByRole('option');
    fireEvent.click(result);
    expect(onChange).toHaveBeenCalledWith('devin');
  });

  it('discovers Devin models and resolves a chosen model into a persisted execution profile', async () => {
    const readyStatus: DevinCliStatus = {
      executable: 'devin.exe', version: 'test', authenticated: true, acp: true, probeChecked: true,
      models: ['swe-2-high'], modelCatalogStatus: 'ready', modelCatalogStale: false,
      modelCatalogDiscoveredAt: 1, hostCount: 0, hosts: [],
    };
    const uncheckedStatus: DevinCliStatus = { ...readyStatus, models: [], modelCatalogStatus: 'not-checked', modelCatalogDiscoveredAt: null };
    vi.mocked(getDevinCliStatus).mockClear().mockResolvedValue(uncheckedStatus);
    vi.mocked(resolveDevinCliExecutionProfile).mockResolvedValue(profile({
      id: 'devin-swe-2', name: 'Devin · swe-2-high', kind: 'devin-cli-acp', provider: undefined, model: 'swe-2-high',
    }));
    const onChange = vi.fn();
    render(<ExecutionProfileCombobox
      profiles={[profile({ id: 'devin-existing', kind: 'devin-cli-acp', provider: undefined, model: 'glm-5.2' })]}
      value="" onChange={onChange}
    />);

    const input = screen.getByRole('combobox', { name: 'Provider and model' });
    await waitFor(() => expect(getDevinCliStatus).toHaveBeenCalled());
    const checksBeforeOpening = vi.mocked(getDevinCliStatus).mock.calls.length;
    vi.mocked(getDevinCliStatus).mockResolvedValue(readyStatus);
    fireEvent.focus(input);
    const option = await screen.findByRole('option', { name: /Devin CLI · swe-2-high/ });
    expect(vi.mocked(getDevinCliStatus).mock.calls.length).toBeGreaterThan(checksBeforeOpening);
    expect(within(option).getByText('Free · Pro+ · Oct 16')).toBeInTheDocument();
    fireEvent.click(option);

    expect(resolveDevinCliExecutionProfile).toHaveBeenCalledWith('swe-2-high');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('devin-swe-2'));
    const selectedProfile = profile({ id: 'devin-swe-2', name: 'Devin · swe-2-high', kind: 'devin-cli-acp', provider: undefined, model: 'swe-2-high' });
    render(<ExecutionProfileCombobox profiles={[selectedProfile]} value="devin-swe-2" onChange={vi.fn()} />);
    expect(screen.getByTestId('selected-model-cost-note')).toHaveTextContent(/free in Devin Desktop and CLI on Pro or higher through October 16, 2026/i);
  });

  it('identifies Devin SWE-1.7 as the model listed for the Free plan', () => {
    render(<ExecutionProfileCombobox
      profiles={[profile({ id: 'devin-free', kind: 'devin-cli-acp', provider: undefined, model: 'swe-1.7' })]}
      value="devin-free" onChange={vi.fn()}
    />);
    expect(screen.getByTestId('selected-model-cost-note')).toHaveTextContent(/unlimited on its Free plan/i);
  });
});
