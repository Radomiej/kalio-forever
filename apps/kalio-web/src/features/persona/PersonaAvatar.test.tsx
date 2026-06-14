import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PersonaAvatarToken } from '@kalio/types';
import { PersonaAvatar } from './PersonaAvatar';

function makeToken(overrides: Partial<PersonaAvatarToken> = {}): PersonaAvatarToken {
  return {
    avatarSeed: 'radek',
    avatarVariant: 'marble',
    avatarPaletteKey: 'ocean',
    avatarIndex: 0,
    ...overrides,
  };
}

describe('PersonaAvatar', () => {
  it('renders an svg avatar for the provided token', () => {
    render(<PersonaAvatar token={makeToken()} size={48} />);

    expect(screen.getByTestId('persona-avatar')).toHaveAttribute('aria-label', 'Avatar marble');
  });

  it('switches its accessible variant label when the token variant changes', () => {
    render(<PersonaAvatar token={makeToken({ avatarVariant: 'ring' })} />);

    expect(screen.getByTestId('persona-avatar')).toHaveAttribute('aria-label', 'Avatar ring');
  });
});
