import Avatar from 'boring-avatars';
import type { PersonaAvatarToken } from '@kalio/types';
import { resolveAvatarColors } from './persona-avatar.utils';

interface Props {
  token: PersonaAvatarToken;
  size?: number;
}

export function PersonaAvatar({ token, size = 40 }: Props) {
  return (
    <Avatar
      size={size}
      name={token.avatarSeed}
      variant={token.avatarVariant}
      colors={resolveAvatarColors(token.avatarPaletteKey)}
    />
  );
}
