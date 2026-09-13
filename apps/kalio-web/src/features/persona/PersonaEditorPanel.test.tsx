import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Credential, ExecutionProfile, Persona } from '@kalio/types';
import { PersonaEditorPanel } from './PersonaEditorPanel';

const getExecutionProfilesMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const getCredentialsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const getCredentialModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const resolveDirectExecutionProfileMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/apiClient', () => ({
  getExecutionProfiles: getExecutionProfilesMock,
  getCredentials: getCredentialsMock,
  getCredentialModels: getCredentialModelsMock,
  resolveDirectExecutionProfile: resolveDirectExecutionProfileMock,
}));

vi.mock('./PersonaToolPicker', () => ({
  PersonaToolPicker: () => <div data-testid="persona-tool-picker" />,
}));

const PERSONA: Persona = {
  id: 'persona-existing',
  name: 'Existing Persona',
  systemPrompt: 'Stay focused on the current plan.',
  model: 'gpt-4o-mini',
  allowedTools: ['vfs_read_file'],
  skillIds: [],
  mcpPolicy: 'allow_all',
  avatarSeed: 'locked-seed',
  avatarVariant: 'ring',
  avatarPaletteKey: 'violet',
  avatarIndex: 4,
  createdAt: 1,
  updatedAt: 1,
};

const CLAUDE_PROFILE: ExecutionProfile = {
  id: 'claude-local',
  name: 'Claude Code - Local Login',
  kind: 'claude-agent-sdk',
  model: 'claude-sonnet-4-6',
  reasoningEffort: 'high',
  approvalMode: 'kalio_strict',
  enabled: true,
  capabilitiesVersion: '1',
  createdAt: 1,
  updatedAt: 1,
};

const DIRECT_CREDENTIAL: Credential = {
  id: 'credential-openrouter',
  name: 'OpenRouter main',
  provider: 'openrouter',
  model: 'openrouter/default',
  createdAt: 1,
};

const DIRECT_PROFILE: ExecutionProfile = {
  id: 'direct-openrouter-fast',
  name: 'Direct LLM - openrouter - openrouter/fast',
  kind: 'direct-llm',
  provider: 'openrouter',
  model: 'openrouter/fast',
  authProfileId: DIRECT_CREDENTIAL.id,
  approvalMode: 'codex_guard',
  enabled: true,
  capabilitiesVersion: '1',
  createdAt: 1,
  updatedAt: 1,
};

describe('PersonaEditorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getExecutionProfilesMock.mockResolvedValue([]);
    getCredentialsMock.mockResolvedValue([]);
    getCredentialModelsMock.mockResolvedValue([]);
  });

  it('saves edited persona from the main panel with avatar token', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<PersonaEditorPanel mode="edit" persona={PERSONA} onSave={onSave} onDelete={vi.fn()} />);

    fireEvent.change(screen.getByTestId('persona-name-input'), { target: { value: 'Updated Persona' } });
    fireEvent.change(screen.getByTestId('persona-model-input'), { target: { value: 'gpt-4.1-mini' } });
    fireEvent.change(screen.getByTestId('persona-prompt-textarea'), { target: { value: 'Trimmed prompt.' } });

    await user.click(screen.getByTestId('persona-save-btn'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        name: 'Updated Persona',
        model: 'gpt-4.1-mini',
        systemPrompt: 'Trimmed prompt.',
        allowedTools: ['vfs_read_file'],
        providerToolNames: [],
        mcpPolicy: 'allow_all',
        avatarSeed: 'locked-seed',
        avatarVariant: 'sunset',
        avatarPaletteKey: 'ocean',
        avatarIndex: 4,
      });
    });
  });

  it('keeps manually selected avatar when name changes in create mode', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<PersonaEditorPanel mode="create" persona={null} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByTestId('persona-name-input'), { target: { value: 'Alpha' } });
    await user.click(screen.getByTestId('persona-change-avatar-btn'));
    await user.click(screen.getByTestId('persona-avatar-option-2'));

    fireEvent.change(screen.getByTestId('persona-name-input'), { target: { value: 'Beta Name' } });
    fireEvent.change(screen.getByTestId('persona-prompt-textarea'), { target: { value: 'Prompt.' } });
    await user.click(screen.getByTestId('persona-save-btn'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Beta Name',
        avatarSeed: 'avatar-qiabj7-2',
        avatarVariant: 'pixel',
        avatarPaletteKey: 'ocean',
        avatarIndex: 2,
      }));
    });
  });

  it('binds a persona to Claude Code and inherits its model and reasoning level', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    getExecutionProfilesMock.mockResolvedValueOnce([CLAUDE_PROFILE]);

    render(<PersonaEditorPanel mode="create" persona={null} onSave={onSave} onCancel={vi.fn()} />);

    const runtimeSelect = await screen.findByTestId('persona-runtime-kind-select');
    await waitFor(() => expect(runtimeSelect).toBeEnabled());
    await user.selectOptions(runtimeSelect, 'claude-agent-sdk');
    expect(screen.getByTestId('persona-model-input')).toHaveValue('claude-sonnet-4-6');
    expect(screen.getByTestId('persona-reasoning-select')).toHaveValue('high');

    fireEvent.change(screen.getByTestId('persona-name-input'), { target: { value: 'Claude Sonnet' } });
    fireEvent.change(screen.getByTestId('persona-prompt-textarea'), { target: { value: 'Use Claude.' } });
    await user.click(screen.getByTestId('persona-save-btn'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Claude Sonnet',
        model: 'claude-sonnet-4-6',
        executionProfileId: 'claude-local',
      }));
    });
  });

  it('resolves a Direct LLM profile for the selected provider connection', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    getCredentialsMock.mockResolvedValueOnce([DIRECT_CREDENTIAL]);
    getCredentialModelsMock.mockResolvedValueOnce(['openrouter/default', 'openrouter/fast']);
    resolveDirectExecutionProfileMock.mockResolvedValueOnce(DIRECT_PROFILE);

    render(<PersonaEditorPanel mode="create" persona={null} onSave={onSave} onCancel={vi.fn()} />);

    const runtimeSelect = await screen.findByTestId('persona-runtime-kind-select');
    await waitFor(() => expect(runtimeSelect).toBeEnabled());
    await user.selectOptions(screen.getByTestId('persona-direct-provider-select'), DIRECT_CREDENTIAL.id);
    await waitFor(() => expect(screen.getByTestId('persona-model-input')).toHaveValue('openrouter/default'));
    await user.selectOptions(screen.getByTestId('persona-model-input'), 'openrouter/fast');
    fireEvent.change(screen.getByTestId('persona-name-input'), { target: { value: 'OpenRouter persona' } });
    await user.click(screen.getByTestId('persona-save-btn'));

    await waitFor(() => {
      expect(resolveDirectExecutionProfileMock).toHaveBeenCalledWith({
        credentialId: DIRECT_CREDENTIAL.id,
        model: 'openrouter/fast',
      });
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        name: 'OpenRouter persona',
        model: 'openrouter/fast',
        executionProfileId: DIRECT_PROFILE.id,
      }));
    });
  });
});
