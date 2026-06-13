import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Persona } from '@kalio/types';
import { PersonaEditorPanel } from './PersonaEditorPanel';

vi.mock('boring-avatars', () => ({
  default: ({ name }: { name: string }) => <svg data-testid="boring-avatar">{name}</svg>,
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

describe('PersonaEditorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        mcpPolicy: 'allow_all',
        avatarSeed: 'locked-seed',
        avatarVariant: 'ring',
        avatarPaletteKey: 'violet',
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
        avatarSeed: 'alpha#2',
        avatarVariant: 'pixel',
        avatarPaletteKey: 'ocean',
        avatarIndex: 2,
      }));
    });
  });
});
