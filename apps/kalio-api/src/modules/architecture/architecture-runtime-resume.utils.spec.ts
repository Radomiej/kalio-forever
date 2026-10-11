import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { prepareArchitectureResume, prepareArchitectureResumeRun, resolveArchitectureResumeCursor } from './architecture-runtime-resume.utils';

const run = (): ArchitectureRun => ({ id: 'run', schemaId: 'schema', prompt: 'Original',
  executionMode: 'session_branches', status: 'failed', createdAt: 1, updatedAt: 1,
  context: { goalProtocol: 1 } });

describe('prepareArchitectureResumeRun', () => {
  it.each(['before', 'admission', 'route'])('does not expose raw Stop reason during %s', async stage => {
    const controller = new AbortController();
    const raw = new Error('PRIVATE_ABORT_REASON');
    if (stage === 'before') controller.abort(raw);
    const resume = vi.fn(async () => { if (stage === 'admission') { controller.abort(raw); throw raw; } return run(); });
    const resolve = vi.fn(async () => { controller.abort(raw); throw raw; });
    await expect(prepareArchitectureResume(run(), {} as ArchitectureSchema, {}, [], controller.signal, { resume }, { resolve }))
      .rejects.toThrow(/^GOAL_RESUME_ABORTED$/);
  });
  it('verifies only the admitted canonical goal and propagates stale route rejection', async () => {
    const admitted = { ...run(), prompt: 'Updated canonical goal' };
    const order: string[] = [];
    const resume = vi.fn(async () => { order.push('admission ACK'); return admitted; });
    const resolve = vi.fn(async (input: { run: ArchitectureRun }) => {
      order.push('route verification');
      expect(input.run.prompt).toBe(admitted.prompt);
      throw new Error('STALE_GOAL_ROUTE');
    });
    await expect(prepareArchitectureResume(run(), {} as ArchitectureSchema, { input: 'Update' }, [],
      new AbortController().signal, { resume }, { resolve })).rejects.toThrow('STALE_GOAL_ROUTE');
    expect(order).toEqual(['admission ACK', 'route verification']);
  });
  it('does not mutate goal admission when route authority is unavailable', async () => {
    const resume = vi.fn();
    await expect(prepareArchitectureResume(run(), {} as ArchitectureSchema, {}, [],
      new AbortController().signal, { resume })).rejects.toThrow('GOAL_ROUTE_RESUME_UNAVAILABLE');
    expect(resume).not.toHaveBeenCalled();
  });
  it('never falls back to graph roots or a caller cursor for goal resume without trusted recovery', async () => {
    const cursor = { reason: 'runtime_recovery' as const, pendingNodeIds: ['worker'], visitCounts: {} };
    await expect(resolveArchitectureResumeCursor(run(), {} as ArchitectureSchema, {}, [], new AbortController().signal))
      .rejects.toThrow('GOAL_ROUTE_RESUME_UNAVAILABLE');
    const resolve = vi.fn(async () => cursor);
    expect(await resolveArchitectureResumeCursor(run(), {} as ArchitectureSchema, {}, [], new AbortController().signal, { resolve }))
      .toBe(cursor);
    expect(resolve).toHaveBeenCalledOnce();
  });
  it('does not return a trusted cursor after stop during verification', async () => {
    const controller = new AbortController();
    await expect(resolveArchitectureResumeCursor(run(), {} as ArchitectureSchema, {}, [], controller.signal, {
      resolve: async () => { controller.abort(); return { reason: 'runtime_recovery', pendingNodeIds: ['worker'], visitCounts: {} }; },
    })).rejects.toThrow();
  });
  it('rejects missing goal admission instead of legacy concatenation', async () => {
    await expect(prepareArchitectureResumeRun(run(), { input: 'Raw update' })).rejects.toThrow('GOAL_RESUME_UNAVAILABLE');
  });
  it('uses canonical admitted prompt and forwards persisted source, never concatenating raw input', async () => {
    const original = run();
    const resume = vi.fn(async () => ({ ...original, prompt: 'Canonical original' }));
    const source = { sessionId: 'host', messageId: 'message', turnId: 'turn' };
    const result = await prepareArchitectureResumeRun(original, {
      input: 'Raw update', goalResume: { source, expectedRevision: 2 }, maxSteps: 7,
    }, { resume });
    expect(resume).toHaveBeenCalledWith(original, { source, expectedRevision: 2, input: 'Raw update' });
    expect(result.prompt).toBe('Canonical original');
    expect(result.context?.['maxArchitectureSteps']).toBe(7);
    expect(original.status).toBe('failed');
  });
  it('rejects attempts to disable the existing goal marker', async () => {
    await expect(prepareArchitectureResumeRun(run(), { context: { goalProtocol: 0 } },
      { resume: vi.fn() })).rejects.toThrow('GOAL_RESUME_PROTOCOL_INVALID');
  });
  it('preserves legacy follow-up semantics', async () => {
    const legacy = { ...run(), context: undefined };
    expect((await prepareArchitectureResumeRun(legacy, { input: ' Next ' })).prompt).toBe('Original\n\nResume input: Next');
  });
});
