import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit.service';
import type { DrizzleService } from '../../../database/drizzle.service';

function makeDrizzle(opts: { fail?: boolean } = {}): { drizzle: DrizzleService; inserted: unknown[]; updated: unknown[]; deleted: unknown[]; runQueries: unknown[] } {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const deleted: unknown[] = [];
  const runQueries: unknown[] = [];
  const insert = () => ({
    values: (row: unknown) => {
      if (opts.fail) throw new Error('db unavailable');
      inserted.push(row);
      return Promise.resolve();
    },
  });
  const update = () => ({
    set: (patch: unknown) => ({
      where: () => {
        if (opts.fail) throw new Error('db unavailable');
        updated.push(patch);
        return Promise.resolve();
      },
    }),
  });
  const deleteFn = () => ({
    where: (condition: unknown) => {
      if (opts.fail) throw new Error('db unavailable');
      deleted.push(condition);
      return Promise.resolve();
    },
  });
  const run = (query: unknown) => {
    if (opts.fail) throw new Error('db unavailable');
    runQueries.push(query);
    return Promise.resolve();
  };
  return { drizzle: { db: { insert, update, delete: deleteFn, run } } as unknown as DrizzleService, inserted, updated, deleted, runQueries };
}

describe('AuditService', () => {
  let service: AuditService;
  let inserted: unknown[];
  let updated: unknown[];

  beforeEach(() => {
    vi.stubEnv('AUDIT_LOG_PRUNE_EVERY_WRITES', '100');
    vi.stubEnv('AUDIT_LOG_MAX_ROWS', '50000');
    vi.stubEnv('AUDIT_LOG_RETENTION_DAYS', '14');
    vi.stubEnv('AUDIT_LOG_ARCHIVE_MAX_ROWS', '250000');
    vi.stubEnv('AUDIT_LOG_ARCHIVE_RETENTION_DAYS', '90');
    const fixture = makeDrizzle();
    service = new AuditService(fixture.drizzle);
    inserted = fixture.inserted;
    updated = fixture.updated;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('periodically prunes old audit rows and caps hot storage rows', async () => {
    vi.stubEnv('AUDIT_LOG_PRUNE_EVERY_WRITES', '2');
    const fixture = makeDrizzle();
    const pruningService = new AuditService(fixture.drizzle);

    await seedLastRetentionRun(pruningService);

    await pruningService.log({ type: 'llm_request', label: 'one' });
    await pruningService.log({ type: 'llm_response', label: 'two' });
    await vi.waitFor(() => expect(fixture.runQueries).toHaveLength(4));

    expect(fixture.deleted).toHaveLength(2);
    expect(fixture.runQueries).toHaveLength(4);
  });

  it('runs retention on the first write when no prior retention timestamp exists', async () => {
    vi.stubEnv('AUDIT_LOG_PRUNE_EVERY_WRITES', '100');
    const fixture = makeDrizzle();
    const pruningService = new AuditService(fixture.drizzle);

    await pruningService.log({ type: 'llm_request', label: 'first write after restart' });

    await vi.waitFor(() => expect(fixture.runQueries).toHaveLength(4));
    expect(fixture.deleted).toHaveLength(2);
  });

  it('runs retention when the interval elapses before the write counter is reached', async () => {
    vi.stubEnv('AUDIT_LOG_PRUNE_EVERY_WRITES', '100');
    vi.stubEnv('AUDIT_LOG_PRUNE_INTERVAL_HOURS', '24');
    const fixture = makeDrizzle();
    const pruningService = new AuditService(fixture.drizzle);
    const testable = pruningService as unknown as { recordRetentionRun: (timestamp: number) => Promise<void> };
    await testable.recordRetentionRun(Date.now() - 25 * 60 * 60 * 1000);

    await pruningService.log({ type: 'llm_request', label: 'daily cold copy' });

    await vi.waitFor(() => expect(fixture.runQueries).toHaveLength(4));
    expect(fixture.deleted).toHaveLength(2);
  });

  it('runs due retention from runtime maintenance without waiting for a new audit write', async () => {
    vi.stubEnv('AUDIT_LOG_PRUNE_INTERVAL_HOURS', '24');
    const fixture = makeDrizzle();
    const pruningService = new AuditService(fixture.drizzle);
    const testable = pruningService as unknown as {
      recordRetentionRun: (timestamp: number) => Promise<void>;
      runRetentionIfDue: () => Promise<void>;
    };
    await testable.recordRetentionRun(Date.now() - 25 * 60 * 60 * 1000);

    await testable.runRetentionIfDue();

    expect(fixture.runQueries).toHaveLength(4);
    expect(fixture.deleted).toHaveLength(2);
  });

  describe('update()', () => {
    it('updates chunkCount and durationMs on existing row', async () => {
      const id = await service.log({ type: 'llm_request', label: 'start' });
      await service.update(id, { chunkCount: 42, durationMs: 1234 });
      expect(updated).toHaveLength(1);
      const patch = updated[0] as Record<string, unknown>;
      expect(patch.chunkCount).toBe(42);
      expect(patch.durationMs).toBe(1234);
    });

    it('updates only data when only data is provided', async () => {
      const id = await service.log({ type: 'llm_request', label: 'start' });
      await service.update(id, { data: { tokens: 100 } });
      const patch = updated[0] as Record<string, unknown>;
      expect(patch.data).toEqual({ tokens: 100 });
      expect('chunkCount' in patch).toBe(false);
      expect('durationMs' in patch).toBe(false);
    });

    it('swallows db errors on update failure', async () => {
      const fixture = makeDrizzle({ fail: true });
      const failing = new AuditService(fixture.drizzle);
      const warn = vi.spyOn((failing as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
      await expect(failing.update('some-id', { chunkCount: 1 })).resolves.not.toThrow();
      expect(warn).toHaveBeenCalled();
    });
  });

  it('caps archived audit rows during retention', async () => {
    vi.stubEnv('AUDIT_LOG_PRUNE_EVERY_WRITES', '2');
    vi.stubEnv('AUDIT_LOG_ARCHIVE_MAX_ROWS', '2');
    vi.stubEnv('AUDIT_LOG_ARCHIVE_RETENTION_DAYS', '365');
    const fixture = makeDrizzle();
    const archiveCappedService = new AuditService(fixture.drizzle);

    await seedLastRetentionRun(archiveCappedService);

    await archiveCappedService.log({ type: 'llm_request', label: 'one' });
    await archiveCappedService.log({ type: 'llm_response', label: 'two' });

    await vi.waitFor(() => expect(fixture.runQueries).toHaveLength(4));
    expect(fixture.deleted).toHaveLength(2);
  });

});

async function seedLastRetentionRun(service: AuditService): Promise<void> {
  const testable = service as unknown as { recordRetentionRun: (timestamp: number) => Promise<void> };
  await testable.recordRetentionRun(Date.now());
}
