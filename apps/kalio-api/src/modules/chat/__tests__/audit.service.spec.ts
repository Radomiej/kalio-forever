import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from '../audit.service';
import type { DrizzleService } from '../../../database/drizzle.service';

function makeDrizzle(opts: { fail?: boolean } = {}): { drizzle: DrizzleService; inserted: unknown[] } {
  const inserted: unknown[] = [];
  const insert = () => ({
    values: (row: unknown) => {
      if (opts.fail) throw new Error('db unavailable');
      inserted.push(row);
      return Promise.resolve();
    },
  });
  return { drizzle: { db: { insert } } as unknown as DrizzleService, inserted };
}

describe('AuditService', () => {
  let service: AuditService;
  let inserted: unknown[];

  beforeEach(() => {
    const fixture = makeDrizzle();
    service = new AuditService(fixture.drizzle);
    inserted = fixture.inserted;
  });

  it('inserts an audit row with the given fields', async () => {
    await service.log({
      sessionId: 'sid',
      type: 'llm_request',
      label: 'turn-start',
      data: { foo: 1 },
      durationMs: 12,
    });
    expect(inserted).toHaveLength(1);
    const row = inserted[0] as Record<string, unknown>;
    expect(row.sessionId).toBe('sid');
    expect(row.type).toBe('llm_request');
    expect(row.label).toBe('turn-start');
    expect(row.data).toEqual({ foo: 1 });
    expect(row.durationMs).toBe(12);
    expect(row.id).toBeTruthy();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('defaults missing optional fields to null', async () => {
    await service.log({ type: 'error', label: 'oops' });
    const row = inserted[0] as Record<string, unknown>;
    expect(row.sessionId).toBeNull();
    expect(row.data).toBeNull();
    expect(row.durationMs).toBeNull();
  });

  it('swallows db errors so audit failure cannot break a chat turn', async () => {
    const fixture = makeDrizzle({ fail: true });
    const failing = new AuditService(fixture.drizzle);
    const warn = vi.spyOn((failing as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
    // log() always returns a string id even when the DB insert fails
    const result = await failing.log({ type: 'error', label: 'x' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
  });
});
