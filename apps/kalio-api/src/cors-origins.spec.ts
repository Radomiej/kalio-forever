import { describe, expect, it } from 'vitest';
import { normalizeCorsOrigins } from './cors-origins';

describe('normalizeCorsOrigins', () => {
  it('keeps wildcard origins untouched', () => {
    expect(normalizeCorsOrigins('*')).toBe('*');
    expect(normalizeCorsOrigins(undefined)).toBe('*');
  });

  it('expands localhost origins with 127.0.0.1 aliases', () => {
    expect(normalizeCorsOrigins('http://localhost:5188')).toEqual([
      'http://localhost:5188',
      'http://127.0.0.1:5188',
    ]);
  });

  it('expands 127.0.0.1 origins with localhost aliases', () => {
    expect(normalizeCorsOrigins('http://127.0.0.1:5188')).toEqual([
      'http://127.0.0.1:5188',
      'http://localhost:5188',
    ]);
  });

  it('preserves multiple explicit origins without duplication', () => {
    expect(normalizeCorsOrigins('http://localhost:5188, http://127.0.0.1:5188, http://example.com')).toEqual([
      'http://localhost:5188',
      'http://127.0.0.1:5188',
      'http://example.com',
    ]);
  });
});
