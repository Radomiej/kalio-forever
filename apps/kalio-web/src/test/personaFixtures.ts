import type { Persona } from '@kalio/types';

export const DEFAULT_TEST_PERSONA_AVATAR: Pick<
  Persona,
  'avatarSeed' | 'avatarVariant' | 'avatarPaletteKey' | 'avatarIndex'
> = {
  avatarSeed: 'test persona',
  avatarVariant: 'marble',
  avatarPaletteKey: 'ocean',
  avatarIndex: 0,
};

export function withTestPersonaAvatar<T extends Omit<Persona, keyof typeof DEFAULT_TEST_PERSONA_AVATAR>>(persona: T): Persona {
  return { ...DEFAULT_TEST_PERSONA_AVATAR, ...persona };
}
