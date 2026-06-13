import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonaAvatarModal } from './PersonaAvatarModal';

vi.mock('boring-avatars', () => ({
  default: ({ name }: { name: string }) => <svg data-testid="boring-avatar">{name}</svg>,
}));

const SELECTED = {
  avatarSeed: 'planner',
  avatarVariant: 'marble' as const,
  avatarPaletteKey: 'ocean' as const,
  avatarIndex: 0,
};

describe('PersonaAvatarModal', () => {
  it('renders initial candidates and loads more on button click', async () => {
    const user = userEvent.setup();
    render(
      <PersonaAvatarModal
        baseSeed="Planner"
        selected={SELECTED}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByTestId('persona-avatar-modal')).toBeInTheDocument();
    expect(screen.getAllByTestId('boring-avatar')).toHaveLength(24);

    await user.click(screen.getByTestId('persona-avatar-load-more-btn'));
    expect(screen.getAllByTestId('boring-avatar')).toHaveLength(48);
  });

  it('selects avatar candidate and closes via callback', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <PersonaAvatarModal
        baseSeed="Planner"
        selected={SELECTED}
        onClose={onClose}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByTestId('persona-avatar-option-3'));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      avatarIndex: 3,
      avatarVariant: 'sunset',
    }));
  });
});
