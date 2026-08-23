import { describe, expect, it } from 'vitest';
import {
  buildAvatarCandidate,
  deriveAvatarSeed,
  defaultAvatarFromName,
  avatarVariantFromSeed,
  fnv1aHash,
  normalizeAvatarSeed,
  resolveCreateAvatar,
  resolvePersonaAvatar,
} from './persona-avatar.utils';

describe('persona-avatar.utils', () => {
  it('normalizes avatar seed from persona name', () => {
    expect(normalizeAvatarSeed('  UX Designer  ')).toBe('ux designer');
    expect(normalizeAvatarSeed('   ')).toBe('persona');
  });

  it('builds deterministic candidates by index', () => {
    const base = 'planner';
    const first = buildAvatarCandidate(base, 0);
    const second = buildAvatarCandidate(base, 1);

    expect(first).toEqual({
      avatarSeed: 'planner',
      avatarVariant: 'marble',
      avatarPaletteKey: 'ocean',
      avatarIndex: 0,
    });
    expect(second.avatarSeed).toBe('avatar-h256hq-1');
    expect(second.avatarVariant).toBe('marble');
    expect(second.avatarIndex).toBe(1);
  });

  it('matches Nekko stable seed hashing and variant selection', () => {
    expect(fnv1aHash('same')).toBe(3440134715);
    expect(avatarVariantFromSeed('same')).toBe('bauhaus');
    expect(deriveAvatarSeed('planner', 3)).toBe('avatar-gi5z3s-3');
    expect(avatarVariantFromSeed(deriveAvatarSeed('planner', 3))).toBe('beam');
  });

  it('defaults avatar from name when create dto omits avatar fields', () => {
    expect(resolveCreateAvatar({ name: 'Research Bot' })).toEqual(defaultAvatarFromName('Research Bot'));
  });

  it('uses explicit avatar token on create when all fields are provided', () => {
    expect(resolveCreateAvatar({
      name: 'Research Bot',
      avatarSeed: 'custom-seed',
      avatarVariant: 'ring',
      avatarPaletteKey: 'violet',
      avatarIndex: 12,
    })).toEqual({
      avatarSeed: 'custom-seed',
      avatarVariant: 'ring',
      avatarPaletteKey: 'ocean',
      avatarIndex: 12,
    });
  });

  it('falls back to name-based avatar for legacy rows without stored token', () => {
    expect(resolvePersonaAvatar({ name: 'Legacy Persona' })).toEqual({
      ...defaultAvatarFromName('Legacy Persona'),
      avatarVariant: 'ring',
      avatarPaletteKey: 'ocean',
    });
  });

  it('returns stored avatar token when all fields exist', () => {
    expect(resolvePersonaAvatar({
      name: 'Renamed Persona',
      avatarSeed: 'locked-seed',
      avatarVariant: 'pixel',
      avatarPaletteKey: 'ember',
      avatarIndex: 3,
    })).toEqual({
      avatarSeed: 'locked-seed',
      avatarVariant: 'sunset',
      avatarPaletteKey: 'ocean',
      avatarIndex: 3,
    });
  });
});
