import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '../../../database/schema';
import { DrizzleService } from '../../../database/drizzle.service';
import { HitlRequestService } from '../../hitl/hitl-request.service';
import { ToolConfirmationService } from '../tool-confirmation.service';
import { ChatService } from '../chat.service';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';

function fixture() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE hitl_requests (
    id text PRIMARY KEY NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'pending',
    session_id text NOT NULL, turn_id text, run_id text, tool_call_id text,
    payload text NOT NULL, continuation text, outcome text, revision integer NOT NULL DEFAULT 1,
    created_at integer NOT NULL, updated_at integer NOT NULL, resolved_at integer
  );`);
  const database = new DrizzleService(null as never);
  (database as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
  const requests = new HitlRequestService(database);
  const confirmations = new ToolConfirmationService(null, null, null, requests);
  const controller = new AbortController();
  let ready!: () => void;
  const waiting = new Promise<void>(resolve => { ready = resolve; });
  const ctx: StreamContext = {
    sessionId: 'session', runId: 'run', turnId: 'turn', promptMessageId: 'prompt',
    messageId: 'assistant', abortSignal: controller.signal, state: new TurnState(),
    emit: event => { if (event === 'tool:confirmation_required') queueMicrotask(ready); },
  };
  return { sqlite, database, requests, confirmations, controller, waiting, ctx };
}

describe('live confirmation crash safety (SQLite)', () => {
  it('keeps a claimed execution non-replayable after an effect and failed result acknowledgement', async () => {
    const f = fixture();
    try {
      const approval = f.confirmations.approveOrRequestConfirmation('call', 'fs_write', {}, f.ctx);
      await f.waiting;
      const [pending] = await f.requests.listPending('session');
      await f.confirmations.resolveConfirmation(pending.id, 'session');
      const outcome = await approval;
      expect(outcome.execution).toBeDefined();
      let effects = 0;
      if (outcome.approved) effects++;
      vi.spyOn(f.requests, 'markContinuationToolResult').mockRejectedValue(new Error('result persistence failed'));
      await expect(f.confirmations.finishLiveExecution(outcome.execution!, { status: 'success' })).rejects.toThrow('result persistence failed');
      const restored = new HitlRequestService(f.database);
      const record = await restored.getById(pending.id);
      expect(record?.continuation).toMatchObject({ executionState: 'claimed' });
      const dispatch = vi.fn();
      const chat = new ChatService(
        null as never, null as never, null as never, null as never, null as never, null as never,
        undefined, {} as never, { dispatchApproved: dispatch } as never, restored,
      );
      expect(await chat.resumeApprovedTool(pending.id, f.ctx.emit)).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
      if (await restored.claimApprovedContinuation(pending.id, record!.revision)) effects++;
      expect(effects).toBe(1);
    } finally { f.sqlite.close(); }
  });
  it('claims before returning approval and cannot claim again after reconstruction', async () => {
    const f = fixture();
    try {
      const approval = f.confirmations.approveOrRequestConfirmation('call', 'fs_write', {}, f.ctx);
      await f.waiting;
      const [pending] = await f.requests.listPending('session');
      await f.confirmations.resolveConfirmation(pending.id, 'session');
      const outcome = await approval;
      expect(outcome.approved).toBe(true);
      expect(outcome.execution).toBeDefined();
      const restored = new HitlRequestService(f.database);
      const claimed = await restored.getById(pending.id);
      expect(claimed?.continuation).toMatchObject({ executionState: 'claimed' });
      expect(await restored.claimApprovedContinuation(pending.id, claimed!.revision)).toBeNull();
      await f.confirmations.finishLiveExecution(outcome.execution!, { status: 'success' });
      expect((await restored.getById(pending.id))?.continuation).toMatchObject({ executionState: 'tool_result_committed' });
    } finally { f.sqlite.close(); }
  });

  it.each(['throws', 'false'] as const)('settles abort when cancellation persistence %s, preserving durable pending', async mode => {
    const f = fixture();
    try {
      const approval = f.confirmations.approveOrRequestConfirmation('call', 'fs_write', {}, f.ctx);
      await f.waiting;
      const spy = vi.spyOn(f.requests, 'resolve');
      if (mode === 'throws') spy.mockRejectedValue(new Error('storage unavailable'));
      else spy.mockResolvedValue(false);
      f.controller.abort();
      await expect(approval).resolves.toMatchObject({ approved: false, rejectionMessage: expect.stringContaining('reconciliation') });
      expect(f.confirmations.getPendingConfirmations('session')).toEqual([]);
      expect(await f.requests.listPending('session')).toHaveLength(1);
    } finally { f.sqlite.close(); }
  });
});
