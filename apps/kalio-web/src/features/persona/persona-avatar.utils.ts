/**
 * Persona avatar token helpers.
 * Sync note: keep deterministic rules aligned with apps/kalio-api/src/modules/persona/persona-avatar.utils.ts
 */
import type { AvatarPaletteKey, AvatarVariant, MCPPolicy, Persona, PersonaAvatarToken } from '@kalio/types';

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

export const AVATAR_PALETTES: Record<AvatarPaletteKey, string[]> = {
  ocean: ['#92A1C6', '#146A7C', '#F0AB3D', '#C271B4', '#C20D90'],
  sunset: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff'],
  forest: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'],
  violet: ['#5e60ce', '#7400b8', '#6930c3', '#80ffdb', '#5390d9'],
  ember: ['#fb6900', '#f63700', '#004853', '#007e80', '#00b9bd'],
  slate: ['#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1'],
  candy: ['#ff006e', '#8338ec', '#3a86ff', '#ffbe0b', '#fb5607'],
  mono: ['#111827', '#374151', '#6b7280', '#d1d5db', '#f9fafb'],
};

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

export function personaToAvatarToken(persona: Pick<
  Persona,
  'name' | 'avatarSeed' | 'avatarVariant' | 'avatarPaletteKey' | 'avatarIndex'
>): PersonaAvatarToken {
  if (
    persona.avatarSeed.trim().length > 0
    && persona.avatarVariant
    && persona.avatarPaletteKey
    && typeof persona.avatarIndex === 'number'
  ) {
    return {
      avatarSeed: persona.avatarSeed,
      avatarVariant: persona.avatarVariant,
      avatarPaletteKey: persona.avatarPaletteKey,
      avatarIndex: persona.avatarIndex,
    };
  }
  return defaultAvatarFromName(persona.name);
}

export function resolveAvatarColors(paletteKey: AvatarPaletteKey): string[] {
  return AVATAR_PALETTES[paletteKey];
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
