import { describe, expect, it } from 'vitest';
import {
  buildAvatarCandidate,
  defaultAvatarFromName,
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
    expect(second.avatarSeed).toBe('planner#1');
    expect(second.avatarVariant).toBe('beam');
    expect(second.avatarIndex).toBe(1);
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
      avatarPaletteKey: 'violet',
      avatarIndex: 12,
    });
  });

  it('falls back to name-based avatar for legacy rows without stored token', () => {
    expect(resolvePersonaAvatar({ name: 'Legacy Persona' })).toEqual(defaultAvatarFromName('Legacy Persona'));
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
      avatarVariant: 'pixel',
      avatarPaletteKey: 'ember',
      avatarIndex: 3,
    });
  });
});
