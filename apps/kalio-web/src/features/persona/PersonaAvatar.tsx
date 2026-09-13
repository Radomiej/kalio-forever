import Avatar from 'boring-avatars';
import type { PersonaAvatarToken } from '@kalio/types';
import {
  avatarSeedFor,
  avatarVariantFromSeed,
  DEFAULT_AVATAR_COLORS,
} from './persona-avatar.utils';

interface Props {
  token: PersonaAvatarToken;
  size?: number;
}

export function PersonaAvatar({ token, size = 40 }: Props) {
  const seed = avatarSeedFor(token);
  const variant = avatarVariantFromSeed(seed);

  return (
    <span
      data-testid="persona-avatar"
      data-avatar-seed={seed}
      data-avatar-variant={variant}
      role="img"
      aria-label={`Avatar ${variant}`}
      className="inline-flex shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size }}
    >
      <Avatar
        size={size}
        name={seed}
        variant={variant}
        colors={[...DEFAULT_AVATAR_COLORS]}
        className="h-full w-full"
        aria-hidden="true"
      />
    </span>
  );
}
