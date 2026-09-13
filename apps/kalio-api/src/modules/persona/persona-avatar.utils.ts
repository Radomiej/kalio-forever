/**
 * Persona avatar token helpers.
 * Sync note: seed and variant rules mirror apps/kalio-web/src/features/persona/persona-avatar.utils.ts
 */
import type { AvatarPaletteKey, AvatarVariant, PersonaAvatarToken } from '@kalio/types';

export const AVATAR_VARIANTS: readonly AvatarVariant[] = [
  'beam',
  'marble',
  'pixel',
  'sunset',
  'ring',
  'bauhaus',
] as const;

const DEFAULT_AVATAR_PALETTE_KEY: AvatarPaletteKey = 'ocean';

export function fnv1aHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function normalizeAvatarSeed(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : 'persona';
}

export function avatarVariantFromSeed(seed: string): AvatarVariant {
  return AVATAR_VARIANTS[fnv1aHash(seed) % AVATAR_VARIANTS.length];
}

export function deriveAvatarSeed(baseSeed: string, index: number): string {
  const normalized = baseSeed.trim() || 'nekko-avatar';
  if (index === 0) return normalized;
  const hash = fnv1aHash(`${normalized}:${index}`);
  return `avatar-${hash.toString(36)}-${index.toString(36)}`;
}

export function buildAvatarCandidate(baseSeed: string, index: number): PersonaAvatarToken {
  const avatarSeed = deriveAvatarSeed(baseSeed, index);
  return {
    avatarSeed,
    avatarVariant: avatarVariantFromSeed(avatarSeed),
    avatarPaletteKey: DEFAULT_AVATAR_PALETTE_KEY,
    avatarIndex: index,
  };
}

export function defaultAvatarFromName(name: string): PersonaAvatarToken {
  return buildAvatarCandidate(normalizeAvatarSeed(name), 0);
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
  const avatarSeed = row.avatarSeed?.trim() || normalizeAvatarSeed(row.name);
  return {
    avatarSeed,
    avatarVariant: avatarVariantFromSeed(avatarSeed),
    avatarPaletteKey: DEFAULT_AVATAR_PALETTE_KEY,
    avatarIndex: typeof row.avatarIndex === 'number' ? row.avatarIndex : 0,
  };
}

export function resolveCreateAvatar(dto: {
  name: string;
  avatarSeed?: string;
  avatarVariant?: AvatarVariant;
  avatarPaletteKey?: AvatarPaletteKey;
  avatarIndex?: number;
}): PersonaAvatarToken {
  const avatarSeed = dto.avatarSeed?.trim() || normalizeAvatarSeed(dto.name);
  return {
    avatarSeed,
    avatarVariant: avatarVariantFromSeed(avatarSeed),
    avatarPaletteKey: DEFAULT_AVATAR_PALETTE_KEY,
    avatarIndex: typeof dto.avatarIndex === 'number' ? dto.avatarIndex : 0,
  };
}
