import { describe, expect, it } from 'vitest';
import type { HostResolvedToolDispatch } from '@kalio/types';
import { createHostDispatchRegistryAuthority } from './host-dispatch-registry-authority';

function fixture() {
  const entry = { meta: { name: 'fs_read', description: '', parameters: {}, requiresConfirmation: false },
    catalogEntryId: 'catalog.read', executorImplementationId: 'executor.read', executorImplementationVersion: 1,
    execute: async () => undefined };
  const receipt: HostResolvedToolDispatch = { identity: { runId: 'r', sessionId: 's', turnId: 't', promptMessageId: 'p' },
    callId: 'c', requestedName: 'fs_read', canonicalName: 'fs_read', args: {},
    target: { kind: 'kalio_registry', entryIdentity: entry, executorIdentity: entry.execute, requiresConfirmation: false },
    approval: { kind: 'non_durable', reason: 'not_required' } };
  const entries = [entry];
  return { entry, entries, receipt, authority: createHostDispatchRegistryAuthority(() => entries) };
}

describe('actual registry dispatch authority', () => {
  it('captures only the actual registered objects and reads their stable identity after restart', async () => {
    const f = fixture();
    const target = await f.authority.captureRegisteredTarget(f.receipt);
    expect(target).toMatchObject({ kind: 'kalio_registry', catalogEntryId: 'catalog.read', executorImplementationVersion: 1 });
    expect(await f.authority.readRegisteredTargetExact(target!)).toEqual({ canonicalName: 'fs_read', target });
  });
  it('rejects cloned entry objects despite identical metadata', async () => {
    const f = fixture();
    expect(await f.authority.captureRegisteredTarget({ ...f.receipt, target: { kind: 'kalio_registry',
      entryIdentity: { ...f.entry }, executorIdentity: f.entry.execute, requiresConfirmation: false } })).toBeNull();
  });
  it('rejects replacement executors and changed confirmation policy', async () => {
    const f = fixture();
    f.entry.execute = async () => undefined;
    expect(await f.authority.captureRegisteredTarget(f.receipt)).toBeNull();
    f.entry.execute = f.receipt.target.kind === 'kalio_registry' ? f.receipt.target.executorIdentity as typeof f.entry.execute : f.entry.execute;
    f.entry.meta.requiresConfirmation = true;
    expect(await f.authority.captureRegisteredTarget(f.receipt)).toBeNull();
  });
  it('rejects ambiguous stable identities and missing registrations', async () => {
    const f = fixture(); const target = await f.authority.captureRegisteredTarget(f.receipt);
    f.entries.push({ ...f.entry });
    expect(await f.authority.readRegisteredTargetExact(target!)).toBeNull();
    f.entries.length = 0;
    expect(await f.authority.readRegisteredTargetExact(target!)).toBeNull();
  });
  it('rejects duplicate stable identities before executor entry, not only during result readback', async () => {
    const f = fixture();
    f.entries.push({ ...f.entry, meta: { ...f.entry.meta, name: 'another_read' } });
    expect(await f.authority.captureRegisteredTarget(f.receipt)).toBeNull();
  });
  it('rejects implementation version drift', async () => {
    const f = fixture(); const target = await f.authority.captureRegisteredTarget(f.receipt);
    f.entry.executorImplementationVersion = 2;
    expect(await f.authority.readRegisteredTargetExact(target!)).toBeNull();
  });
  it('never treats an external MCP target as native registry proof', async () => {
    const f = fixture();
    expect(await f.authority.readRegisteredTargetExact({ kind: 'external_mcp', serverKey: 'x', originalName: 'fs_read' })).toBeNull();
  });
  it('rejects incomplete stable metadata instead of inventing an identity', async () => {
    const f = fixture(); f.entry.catalogEntryId = '';
    expect(await f.authority.captureRegisteredTarget(f.receipt)).toBeNull();
  });
  it('uses a static abort error without revealing the caller reason', async () => {
    const f = fixture(); const controller = new AbortController();
    controller.abort(new Error('private reason'));
    await expect(f.authority.captureRegisteredTarget(f.receipt, controller.signal)).rejects.toThrow('HOST_DISPATCH_REGISTRY_ABORTED');
  });
});
