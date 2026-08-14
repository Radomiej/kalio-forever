import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { HitlRequestService } from './hitl-request.service';

function makeService(): HitlRequestService {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE hitl_requests (
    id text PRIMARY KEY NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'pending',
    session_id text NOT NULL, turn_id text, run_id text, tool_call_id text,
    payload text NOT NULL, continuation text, outcome text, revision integer NOT NULL DEFAULT 1,
    created_at integer NOT NULL, updated_at integer NOT NULL, resolved_at integer
  );`);
  const drizzleService = new DrizzleService(null as never);
  (drizzleService as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
  return new HitlRequestService(drizzleService);
}

describe('HitlRequestService', () => {
  it('persists a request and resolves it exactly once with compare-and-set', async () => {
    const service = makeService();
    const request = await service.create({
      kind: 'tool_confirmation', sessionId: 's1', runId: 'run-1', turnId: 't1', toolCallId: 'call-1',
      payload: { toolName: 'fs_write' },
      continuation: {
        version: 1,
        kind: 'approved_tool_then_resume_turn',
        executionState: 'pending',
        messageId: 'assistant-tool-message',
        iteration: 2,
        currentLimit: 30,
      },
    });

    expect(request.runId).toBe('run-1');
    expect(request.continuation).toMatchObject({
      version: 1,
      kind: 'approved_tool_then_resume_turn',
      executionState: 'pending',
      messageId: 'assistant-tool-message',
      iteration: 2,
      currentLimit: 30,
    });
    expect(await service.listPending('s1')).toHaveLength(1);
    await expect(service.claimApprovedContinuation(request.id, request.revision)).resolves.toBeNull();
    await expect(service.resolve(request.id, request.revision, 'approved')).resolves.toBe(true);
    await expect(service.resolve(request.id, request.revision, 'approved')).resolves.toBe(false);
    await expect(service.listPending('s1')).resolves.toEqual([]);

    const approved = await service.getById(request.id);
    expect(approved).toMatchObject({ status: 'approved', revision: 2 });
    const claimed = await service.claimApprovedContinuation(request.id, approved!.revision);
    expect(claimed).toMatchObject({
      revision: 3,
      continuation: { executionState: 'claimed' },
    });
    await expect(service.claimApprovedContinuation(request.id, approved!.revision)).resolves.toBeNull();
    await expect(service.markContinuationToolResult(request.id, claimed!.revision, { status: 'success' })).resolves.toBe(true);
    await expect(service.getById(request.id)).resolves.toMatchObject({
      revision: 4,
      continuation: { executionState: 'tool_result_committed' },
      outcome: { status: 'success' },
    });
  });

  it('projects only well-formed pending tool confirmations with timeout disabled', async () => {
    const service = makeService();
    await service.create({
      id: 'valid', kind: 'tool_confirmation', sessionId: 's1', toolCallId: 'call-1',
      payload: { toolName: 'fs_write', args: { path: 'report.md' } },
    });
    await service.create({
      id: 'invalid', kind: 'tool_confirmation', sessionId: 's1', toolCallId: 'call-2',
      payload: { toolName: 'fs_write', args: 'not-an-object' },
    });
    await service.create({
      id: 'other-kind', kind: 'tool_budget', sessionId: 's1',
      payload: { toolName: 'fs_write', args: {} },
    });

    await expect(service.listPendingToolConfirmations('s1')).resolves.toEqual([{
      requestId: 'valid', toolCallId: 'call-1', sessionId: 's1', toolName: 'fs_write',
      args: { path: 'report.md' }, timeoutMs: 0,
    }]);
  });
});
