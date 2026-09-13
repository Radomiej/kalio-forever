/**
 * Persona avatar token helpers.
 * Sync note: seed and variant rules mirror Nekko Chat's avatar service.
 * Compatibility token fields remain persisted, but the seed is the visual source of truth.
 */
import type { AvatarPaletteKey, AvatarVariant, MCPPolicy, Persona, PersonaAvatarToken } from '@kalio/types';

export const AVATAR_VARIANTS: readonly AvatarVariant[] = [
  'beam',
  'marble',
  'pixel',
  'sunset',
  'ring',
  'bauhaus',
] as const;

export const DEFAULT_AVATAR_COLORS = [
  '#92A1C6',
  '#146A7C',
  '#F0AB3D',
  '#C271B4',
  '#C20D90',
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

export function avatarSeedFor(identity: { name?: string | null; avatarSeed?: string | null }): string {
  const seed = identity.avatarSeed?.trim();
  return seed || normalizeAvatarSeed(identity.name ?? '');
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

export function personaToAvatarToken(persona: Pick<
  Persona,
  'name' | 'avatarSeed' | 'avatarVariant' | 'avatarPaletteKey' | 'avatarIndex'
>): PersonaAvatarToken {
  const avatarSeed = avatarSeedFor(persona);
  return {
    avatarSeed,
    avatarVariant: avatarVariantFromSeed(avatarSeed),
    avatarPaletteKey: DEFAULT_AVATAR_PALETTE_KEY,
    avatarIndex: typeof persona.avatarIndex === 'number' ? persona.avatarIndex : 0,
  };
}

export function formatMcpPolicyLabel(policy: MCPPolicy): string {
  if (policy === 'allow_all') return 'MCP allow_all';
  if (policy === 'deny_all') return 'MCP deny_all';
  return 'MCP allow_list';
}

export function formatPersonaListMeta(persona: Pick<Persona, 'allowedTools' | 'mcpPolicy'>): string {
  const toolCount = persona.allowedTools?.length ?? 0;
  const toolLabel = `${toolCount} tool${toolCount === 1 ? '' : 's'}`;
  return `${toolLabel} · ${formatMcpPolicyLabel(persona.mcpPolicy ?? 'allow_all')}`;
}

export function buildAvatarCandidates(baseSeed: string, startIndex: number, count: number): PersonaAvatarToken[] {
  return Array.from({ length: count }, (_, offset) => buildAvatarCandidate(baseSeed, startIndex + offset));
}
