import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../database/schema';
import { DrizzleService } from '../../../database/drizzle.service';
import { HitlRequestService } from '../../hitl/hitl-request.service';
import { ToolConfirmationService } from '../tool-confirmation.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { TurnState } from '../turn-state';
import { readApprovedContinuation, runApprovedToolContinuation } from '../chat-resumed-worker';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { HitlPolicyService } from '../../hitl/hitl-policy.service';
import type { ToolResult, HostHitlExecutionCommit } from '@kalio/types';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture(store = true) {
  const sqlite = new Database(':memory:'); databases.push(sqlite);
  sqlite.exec(`CREATE TABLE hitl_requests (
    id text PRIMARY KEY NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'pending',
    session_id text NOT NULL, turn_id text, run_id text, tool_call_id text,
    payload text NOT NULL, continuation text, outcome text, revision integer NOT NULL DEFAULT 1,
    created_at integer NOT NULL, updated_at integer NOT NULL, resolved_at integer
  );`);
  const database = new DrizzleService(null as never);
  (database as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
  const requests = new HitlRequestService(database);
  const policy = { resolveApproval: vi.fn(async () => ({ status: 'approved', source: 'bypass' })) };
  const confirmations = new ToolConfirmationService(policy as unknown as HitlPolicyService, null, null, store ? requests : null);
  let effects = 0;
  const entry = { meta: { name: 'terminal_spawn', description: '', parameters: {}, requiresConfirmation: true },
    execute: async () => { effects++; return 'mock OS'; } };
  const dispatch = new ToolDispatchService([entry], null, null, null, null, confirmations);
  const controller = new AbortController();
  let commit: ((result: ToolResult) => Promise<HostHitlExecutionCommit>) | undefined;
  const ctx: StreamContext = { sessionId: 'session', runId: 'run', turnId: 'turn', promptMessageId: 'prompt',
    messageId: 'assistant', iteration: 1, currentLimit: 2, runtimeKind: 'chat', state: new TurnState(), emit: () => undefined,
    abortSignal: controller.signal, onResolvedToolDispatch: async () => undefined,
    hostConfirmationRequirement: { kind: 'human_only', toolName: 'terminal_spawn', callId: 'call' },
    registerToolResultReceiptCommit: callback => { commit = callback; } };
  const pending = async () => {
    await vi.waitFor(() => expect(confirmations.getPendingConfirmations('session')).toHaveLength(1));
    return confirmations.getPendingConfirmations('session')[0]!.requestId;
  };
  return { sqlite, requests, policy, confirmations, dispatch, ctx, controller, pending,
    get effects() { return effects; }, get commit() { return commit; } };
}

describe('host-only BUILD confirmation', () => {
  async function seedGated(f: ReturnType<typeof fixture>) {
    return f.requests.create({ id: 'gated', kind: 'tool_confirmation', sessionId: 'session', turnId: 'turn', runId: 'run',
      toolCallId: 'call', payload: { toolName: 'terminal_spawn', args: {} }, continuation: {
        kind: 'approved_tool_then_resume_turn', runtimeKind: 'chat', executionState: 'pending',
        sessionId: 'session', turnId: 'turn', runId: 'run', promptMessageId: 'prompt', iteration: 1, currentLimit: 2,
        hostConfirmationRequirement: f.ctx.hostConfirmationRequirement,
      } });
  }

  it.each([undefined, null, false, {}, { kind: 'human_only', toolName: 'terminal_spawn', callId: 'call', reason: 'secret' }])(
    'rejects an own malformed capability before creating a request: %j', async requirement => {
      const f = fixture();
      const ctx = Object.defineProperty({ ...f.ctx }, 'hostConfirmationRequirement', { value: requirement, enumerable: true });
      await expect(f.dispatch.dispatch('call', 'terminal_spawn', {}, ctx)).rejects.toThrow('HOST_CONFIRMATION');
      expect(f.effects).toBe(0); expect(await f.requests.listPending('session')).toEqual([]);
    });

  it('rejects capability getters without invoking them', async () => {
    const f = fixture(); let reads = 0;
    const ctx = Object.defineProperty({ ...f.ctx }, 'hostConfirmationRequirement', { enumerable: true, get: () => { reads++; return f.ctx.hostConfirmationRequirement; } });
    await expect(f.dispatch.dispatch('call', 'terminal_spawn', {}, ctx)).rejects.toThrow('HOST_CONFIRMATION');
    expect(reads).toBe(0); expect(f.effects).toBe(0);
  });

  it('binds only the actual terminal registry entry, not an external MCP alias', async () => {
    const f = fixture();
    await expect(f.dispatch.dispatch('call', 'mcp_external_terminal_spawn', {}, f.ctx)).rejects.toThrow('HOST_CONFIRMATION');
    expect(f.effects).toBe(0); expect(await f.requests.listPending('session')).toEqual([]);
  });

  it('permits deny/cancel for gated and malformed rows, without requiring an approval origin', async () => {
    const f = fixture(); await seedGated(f);
    expect(await f.requests.resolve('gated', 1, 'denied')).toBe(true);
    expect(await f.requests.getById('gated')).toMatchObject({ status: 'denied' });
    await f.requests.create({ id: 'malformed', kind: 'tool_confirmation', sessionId: 'session', payload: {},
      continuation: { hostConfirmationRequirement: null } });
    expect(await f.requests.resolve('malformed', 1, 'cancelled')).toBe(true);
  });

  it('blocks lost/recovered host rows before approval, claim, runtime admission or executor entry', async () => {
    const f = fixture(); const row = await seedGated(f);
    const fakeInput = { approved: { ...row, status: 'approved' }, controller: new AbortController() };
    expect(await runApprovedToolContinuation(fakeInput as unknown as Parameters<typeof runApprovedToolContinuation>[0])).toBe(false);
    expect(f.effects).toBe(0);
    expect(await f.requests.getById(row.id)).toMatchObject({ revision: 1, status: 'pending' });
  });

  it.each(['foreign-session', 'foreign-call', 'stale'] as const)('refuses %s host claims', async mode => {
    const f = fixture(); await seedGated(f);
    expect(await f.requests.resolveHostConfirmationFromGateway('gated', 1, 'session', 'socket')).toBe(true);
    expect(await f.requests.claimApprovedHostContinuation('gated', mode === 'stale' ? 1 : 2,
      mode === 'foreign-session' ? 'other' : 'session', mode === 'foreign-call' ? 'other' : 'call')).toBeNull();
    expect(await f.requests.getById('gated')).toMatchObject({ revision: 2, continuation: { executionState: 'pending' } });
  });

  it.each(['missing-origin', 'wrong-origin', 'extra-secret', 'wrong-requirement'] as const)('rejects corrupt %s on claim', async mode => {
    const f = fixture(); await seedGated(f);
    await f.requests.resolveHostConfirmationFromGateway('gated', 1, 'session', 'socket');
    const row = await f.requests.getById('gated');
    const cursor = structuredClone(row!.continuation!);
    const origin = cursor['approvalOrigin'] as Record<string, unknown>;
    if (mode === 'missing-origin') delete cursor['approvalOrigin'];
    if (mode === 'wrong-origin') origin['sessionId'] = 'foreign';
    if (mode === 'extra-secret') origin['reason'] = 'secret';
    if (mode === 'wrong-requirement') cursor['hostConfirmationRequirement'] = null;
    f.sqlite.prepare('UPDATE hitl_requests SET continuation = ?').run(JSON.stringify(cursor));
    await expect(f.requests.claimApprovedHostContinuation('gated', 2, 'session', 'call')).rejects.toThrow(/^HOST_CONFIRMATION_CLAIM_FAILED$/);
    expect(await f.requests.getById('gated')).toMatchObject({ revision: 2, continuation: { executionState: 'pending' } });
  });

  it('returns actual claim revision after trigger and rolls back readback corruption', async () => {
    const f = fixture(); await seedGated(f);
    await f.requests.resolveHostConfirmationFromGateway('gated', 1, 'session', 'socket');
    f.sqlite.exec(`CREATE TRIGGER actual_revision AFTER UPDATE OF continuation ON hitl_requests
      BEGIN UPDATE hitl_requests SET revision = 13 WHERE id = NEW.id; END;`);
    expect(await f.requests.claimApprovedHostContinuation('gated', 2, 'session', 'call')).toMatchObject({ revision: 13, continuation: { executionState: 'claimed' } });
    f.sqlite.exec('DROP TRIGGER actual_revision');
    f.sqlite.exec(`CREATE TRIGGER corrupt_origin AFTER UPDATE OF outcome ON hitl_requests
      BEGIN UPDATE hitl_requests SET continuation = json_set(continuation, '$.approvalOrigin.sessionId', 'foreign') WHERE id = NEW.id; END;`);
    await expect(f.requests.markContinuationToolResultRequired('gated', 13, { status: 'success' })).rejects.toThrow(/^HITL_EXECUTION_COMMIT_FAILED$/);
    expect(await f.requests.getById('gated')).toMatchObject({ revision: 13, continuation: { executionState: 'claimed', approvalOrigin: { sessionId: 'session' } } });
  });

  it('rolls back corrupt gateway approval readback and returns no origin/approval ACK', async () => {
    const f = fixture(); await seedGated(f);
    f.sqlite.exec(`CREATE TRIGGER corrupt_scope AFTER UPDATE OF status ON hitl_requests
      BEGIN UPDATE hitl_requests SET tool_call_id = 'foreign' WHERE id = NEW.id; END;`);
    await expect(f.requests.resolveHostConfirmationFromGateway('gated', 1, 'session', 'socket')).rejects.toThrow(/^HOST_CONFIRMATION_PERSISTENCE_FAILED$/);
    expect(await f.requests.getById('gated')).toMatchObject({ status: 'pending', revision: 1, toolCallId: 'call' });
    expect((await f.requests.getById('gated'))?.continuation).not.toHaveProperty('approvalOrigin');
  });
  it('requires gateway-origin approval despite global/subagent bypass, then preserves origin across result commit', async () => {
    const f = fixture();
    const run = f.dispatch.dispatch('call', 'terminal_spawn', {}, { ...f.ctx, agentRun: {
      agentType: 'subagent', agentRunId: 'child', parentSessionId: 'parent', parentToolCallId: 'parent-call', autoApproveTools: ['terminal_spawn'] } });
    const id = await f.pending();
    expect(f.effects).toBe(0); expect(f.policy.resolveApproval).not.toHaveBeenCalled();
    expect(await f.confirmations.resolveConfirmation(id)).toBe('rejected'); // Telegram/generic path.
    expect(await f.confirmations.resolveConfirmationFromGateway(id, 'foreign', 'socket')).toBe('session_mismatch');
    expect(await f.confirmations.resolveConfirmationFromGateway(id, 'session', 'socket', 'secret message')).toBe('resolved');
    const result = await run;
    expect(result.status).toBe('success'); expect(f.effects).toBe(1);
    const before = await f.requests.getById(id);
    expect(before?.continuation?.['hostConfirmationRequirement']).toEqual(f.ctx.hostConfirmationRequirement);
    expect(before?.continuation?.['approvalOrigin']).toMatchObject({ schemaVersion: 1, kind: 'gateway_tool_confirm',
      requestId: id, sessionId: 'session', toolCallId: 'call', socketId: 'socket', approvedFromRevision: 1 });
    expect(JSON.stringify(before?.continuation?.['approvalOrigin'])).not.toContain('secret');
    expect(await f.commit!(result)).toMatchObject({ requestId: id, claimedRevision: 3, committedRevision: 4 });
    const after = await f.requests.getById(id);
    expect(after?.continuation?.['approvalOrigin']).toEqual(before?.continuation?.['approvalOrigin']);
  });

  it.each(['bypass', 'wrong-call', 'no-store', 'no-owner'] as const)('blocks %s before effects or pending leakage', async kind => {
    const f = fixture(kind !== 'no-store');
    const ctx = kind === 'no-owner' ? { ...f.ctx, registerToolResultReceiptCommit: undefined } : f.ctx;
    const run = kind === 'bypass' ? f.dispatch.dispatchApproved('call', 'terminal_spawn', {}, ctx)
      : f.dispatch.dispatch(kind === 'wrong-call' ? 'other' : 'call', 'terminal_spawn', {}, ctx);
    await expect(run).rejects.toThrow('HOST_CONFIRMATION');
    expect(f.effects).toBe(0); expect(await f.requests.listPending('session')).toEqual([]);
  });

  it('rejects generic approval/claim and legacy continuation reconstruction even for malformed own requirement', async () => {
    const f = fixture();
    const row = await f.requests.create({ id: 'gated', kind: 'tool_confirmation', sessionId: 'session', turnId: 'turn',
      toolCallId: 'call', payload: { toolName: 'terminal_spawn', args: {} }, continuation: { kind: 'approved_tool_then_resume_turn',
        runtimeKind: 'chat', executionState: 'pending', promptMessageId: 'prompt', iteration: 1, currentLimit: 2,
        hostConfirmationRequirement: null } });
    expect(await f.requests.resolve(row.id, row.revision, 'approved')).toBe(false);
    f.sqlite.exec("UPDATE hitl_requests SET status = 'approved'");
    expect(await f.requests.claimApprovedContinuation(row.id, row.revision)).toBeNull();
    expect(readApprovedContinuation(await f.requests.getById(row.id))).toBeNull();
    expect(await f.requests.resolve(row.id, row.revision, 'cancelled')).toBe(false); // Already approved.
  });

  it('Stop cancels a genuine gated wait and removes pending state', async () => {
    const f = fixture(); const run = f.dispatch.dispatch('call', 'terminal_spawn', {}, f.ctx);
    const id = await f.pending(); f.controller.abort();
    expect((await run).status).toBe('cancelled'); expect(f.effects).toBe(0);
    expect(await f.requests.getById(id)).toMatchObject({ status: 'cancelled' });
    expect(f.confirmations.getPendingConfirmations('session')).toEqual([]);
  });
});
