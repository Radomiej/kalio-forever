import { describe, it, expect } from 'vitest';
import { toFriendlyName } from './friendlyId';

describe('toFriendlyName', () => {
  it('returns a string in adjective_noun format', () => {
    const name = toFriendlyName('QxXITvX6eqkAbs1X1W3Md');
    expect(name).toMatch(/^[a-z]+_[a-z]+$/);
  });

  it('is deterministic — same input always produces same output', () => {
    const id = 'QxXITvX6eqkAbs1X1W3Md';
    expect(toFriendlyName(id)).toBe(toFriendlyName(id));
    expect(toFriendlyName(id)).toBe(toFriendlyName(id));
  });

  it('different IDs produce different names most of the time', () => {
    const ids = [
      'abc123', 'xyz789', 'hello-world', 'session_1', 'ABCDEFG',
      'uHXsT_9L', 'QxXITvX6eqkAbs1X1W3Md', 'test-session-id',
    ];
    const names = ids.map(toFriendlyName);
    const unique = new Set(names);
    // At least 75% should be unique — collisions are acceptable but should be rare
    expect(unique.size).toBeGreaterThanOrEqual(Math.floor(ids.length * 0.75));
  });

  it('handles empty string gracefully', () => {
    expect(toFriendlyName('')).toBe('unknown_id');
  });

  it('handles short IDs', () => {
    const name = toFriendlyName('a');
    expect(name).toMatch(/^[a-z]+_[a-z]+$/);
  });

  it('handles long IDs', () => {
    const longId = 'a'.repeat(200);
    const name = toFriendlyName(longId);
    expect(name).toMatch(/^[a-z]+_[a-z]+$/);
  });

  it('handles IDs with special characters', () => {
    const name = toFriendlyName('my-session_01/test.id');
    expect(name).toMatch(/^[a-z]+_[a-z]+$/);
  });

  it('produces consistent results for representative generated session IDs', () => {
    const results = new Map<string, string>();
    for (let i = 0; i < 25; i++) {
      const id = `session-${i}`;
      const name = toFriendlyName(id);
      expect(name).toMatch(/^[a-z]+_[a-z]+$/);
      // Must be deterministic within the same run
      expect(toFriendlyName(id)).toBe(name);
      results.set(id, name);
    }
    // Ensure no entry got corrupted
    for (const [id, expected] of results) {
      expect(toFriendlyName(id)).toBe(expected);
    }
  });

  it('uses non-empty adjective and noun parts', () => {
    const name = toFriendlyName('test-id-12345');
    const [adj, noun] = name.split('_');
    expect(adj.length).toBeGreaterThan(0);
    expect(noun.length).toBeGreaterThan(0);
  });
});
