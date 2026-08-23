import { describe, expect, it } from 'vitest';
import {
  buildAvatarCandidate,
  buildAvatarCandidates,
  defaultAvatarFromName,
  deriveAvatarSeed,
  avatarVariantFromSeed,
  formatPersonaListMeta,
  fnv1aHash,
  normalizeAvatarSeed,
  personaToAvatarToken,
} from './persona-avatar.utils';
import type { Persona } from '@kalio/types';

describe('persona-avatar.utils', () => {
  it('normalizes avatar seed from persona name', () => {
    expect(normalizeAvatarSeed('  Planner  ')).toBe('planner');
  });

  it('builds deterministic candidates', () => {
    expect(buildAvatarCandidate('planner', 1)).toMatchObject({
      avatarSeed: 'avatar-h256hq-1',
      avatarVariant: 'marble',
      avatarPaletteKey: 'ocean',
      avatarIndex: 1,
    });
  });

  it('matches Nekko stable seed hashing and variant selection', () => {
    expect(fnv1aHash('same')).toBe(3440134715);
    expect(avatarVariantFromSeed('same')).toBe('bauhaus');
    expect(deriveAvatarSeed('planner', 3)).toBe('avatar-gi5z3s-3');
    expect(avatarVariantFromSeed(deriveAvatarSeed('planner', 3))).toBe('beam');
  });

  it('loads candidate batches for modal picker', () => {
    const batch = buildAvatarCandidates('alpha', 0, 3);
    expect(batch).toHaveLength(3);
    expect(batch[2]?.avatarIndex).toBe(2);
  });

  it('formats list meta with tool count and MCP policy', () => {
    expect(formatPersonaListMeta({ allowedTools: ['a', 'b'], mcpPolicy: 'allow_list' }))
      .toBe('2 tools · MCP allow_list');
  });

  it('falls back to name-based avatar for legacy persona records', () => {
    const legacy = {
      name: 'Legacy Persona',
      avatarSeed: '',
      avatarVariant: 'marble',
      avatarPaletteKey: 'ocean',
      avatarIndex: 0,
    } as Persona;

    expect(personaToAvatarToken(legacy)).toEqual({
      ...defaultAvatarFromName('Legacy Persona'),
      avatarVariant: 'ring',
      avatarPaletteKey: 'ocean',
    });
  });
});
