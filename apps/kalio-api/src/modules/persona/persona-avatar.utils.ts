/**
 * Persona avatar token helpers.
 * Sync note: keep deterministic rules aligned with apps/kalio-web/src/features/persona/persona-avatar.utils.ts
 */
import type { AvatarPaletteKey, AvatarVariant, PersonaAvatarToken } from '@kalio/types';

export const AVATAR_VARIANTS: readonly AvatarVariant[] = [
  'marble',
  'beam',
  'pixel',
  'sunset',
  'ring',
  'bauhaus',
] as const;

export const AVATAR_PALETTE_KEYS: readonly AvatarPaletteKey[] = [
  'ocean',
  'sunset',
  'forest',
  'violet',
  'ember',
  'slate',
  'candy',
  'mono',
] as const;

export function normalizeAvatarSeed(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : 'persona';
}

export function buildAvatarCandidate(baseSeed: string, index: number): PersonaAvatarToken {
  const variant = AVATAR_VARIANTS[index % AVATAR_VARIANTS.length];
  const paletteKey = AVATAR_PALETTE_KEYS[
    Math.floor(index / AVATAR_VARIANTS.length) % AVATAR_PALETTE_KEYS.length
  ];
  const avatarSeed = index === 0 ? baseSeed : `${baseSeed}#${index}`;
  return {
    avatarSeed,
    avatarVariant: variant,
    avatarPaletteKey: paletteKey,
    avatarIndex: index,
  };
}

export function defaultAvatarFromName(name: string): PersonaAvatarToken {
  return buildAvatarCandidate(normalizeAvatarSeed(name), 0);
}

export function hasStoredAvatarToken(row: {
  avatarSeed?: string | null;
  avatarVariant?: string | null;
  avatarPaletteKey?: string | null;
  avatarIndex?: number | null;
}): row is { avatarSeed: string; avatarVariant: string; avatarPaletteKey: string; avatarIndex: number } {
  return (
    typeof row.avatarSeed === 'string'
    && row.avatarSeed.trim().length > 0
    && typeof row.avatarVariant === 'string'
    && row.avatarVariant.trim().length > 0
    && typeof row.avatarPaletteKey === 'string'
    && row.avatarPaletteKey.trim().length > 0
    && typeof row.avatarIndex === 'number'
  );
}

export function resolvePersonaAvatar(
  row: {
    name: string;
    avatarSeed?: string | null;
    avatarVariant?: string | null;
    avatarPaletteKey?: string | null;
    avatarIndex?: number | null;
  },
): PersonaAvatarToken {
  if (hasStoredAvatarToken(row)) {
    return {
      avatarSeed: row.avatarSeed,
      avatarVariant: row.avatarVariant as AvatarVariant,
      avatarPaletteKey: row.avatarPaletteKey as AvatarPaletteKey,
      avatarIndex: row.avatarIndex,
    };
  }
  return defaultAvatarFromName(row.name);
}

type CreateAvatarInput = {
  name: string;
  avatarSeed?: string;
  avatarVariant?: AvatarVariant;
  avatarPaletteKey?: AvatarPaletteKey;
  avatarIndex?: number;
};

function isCreateAvatarComplete(
  dto: CreateAvatarInput
): dto is CreateAvatarInput & Required<Pick<CreateAvatarInput, 'avatarSeed' | 'avatarVariant' | 'avatarPaletteKey' | 'avatarIndex'>> {
  return typeof dto.avatarSeed === 'string'
    && dto.avatarSeed.trim().length > 0
    && dto.avatarVariant !== undefined
    && dto.avatarPaletteKey !== undefined
    && typeof dto.avatarIndex === 'number';
}

export function resolveCreateAvatar(dto: {
  name: string;
  avatarSeed?: string;
  avatarVariant?: AvatarVariant;
  avatarPaletteKey?: AvatarPaletteKey;
  avatarIndex?: number;
}): PersonaAvatarToken {
  if (isCreateAvatarComplete(dto)) {
    return {
      avatarSeed: dto.avatarSeed.trim(),
      avatarVariant: dto.avatarVariant,
      avatarPaletteKey: dto.avatarPaletteKey,
      avatarIndex: dto.avatarIndex,
    };
  }

  return defaultAvatarFromName(dto.name);
}
