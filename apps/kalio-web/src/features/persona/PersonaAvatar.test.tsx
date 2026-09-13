import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PersonaAvatarToken } from '@kalio/types';
import { PersonaAvatar } from './PersonaAvatar';
import { avatarVariantFromSeed } from './persona-avatar.utils';

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

    expect(screen.getByTestId('persona-avatar')).toHaveAttribute('aria-label', `Avatar ${avatarVariantFromSeed('radek')}`);
    expect(screen.getByTestId('persona-avatar')).toHaveAttribute('data-avatar-seed', 'radek');
  });

  it('derives the rendered variant from the seed instead of stored legacy fields', () => {
    render(<PersonaAvatar token={makeToken({ avatarSeed: 'same', avatarVariant: 'ring' })} />);

    expect(screen.getByTestId('persona-avatar')).toHaveAttribute('aria-label', 'Avatar bauhaus');
  });
});
