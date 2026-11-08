import { describe, expect, it, vi } from 'vitest';
import { awaitToolConfirmation, type ToolConfirmationWaitInput } from './tool-confirmation-wait';
import { TurnState } from './turn-state';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { ToolConfirmationService } from './tool-confirmation.service';
import type { PendingConfirmation } from './tool-confirmation-pending';

function fixture() {
  const controller = new AbortController();
  const order: string[] = [];
  const input: ToolConfirmationWaitInput = {
    callId: 'call', toolName: 'tool', args: {}, pending: new Map(),
    ctx: { sessionId: 'session', messageId: 'message', state: new TurnState(), abortSignal: controller.signal,
      markWaitingForHuman: async () => { order.push('waiting'); },
      emit: () => { order.push('emit'); expect(input.pending.size).toBe(0); } },
    hitlRequests: null, hitlNotifications: null, runtimeAudit: null,
    logger: { warn: vi.fn(), error: vi.fn() },
    emitConfirmationInvalidated: vi.fn(), logConfirmationLifecycle: vi.fn(), logRuntimeConfirmation: vi.fn(),
  };
  return { input, controller, order };
}

describe('extracted confirmation wait parity', () => {
  it('does not give an optional unpersisted waiter manual budget authority', async () => {
    const { input } = fixture();
    const begin = vi.fn(() => vi.fn());
    Object.assign(input.ctx, { beginManualToolWait: begin });
    const waiting = awaitToolConfirmation(input);
    await vi.waitFor(() => expect(input.pending.size).toBe(1));
    [...input.pending.values()][0]!.reject();
    await waiting;
    expect(begin).not.toHaveBeenCalled();
  });
  it('carries a bounded policy reason in the existing request and requested audits with the actual wait ID', async () => {
    const { input } = fixture();
    input.policyReason = 'Local decision (fixture:1): ask_user. Human context required.';
    const log = vi.fn().mockResolvedValue('audit'); const notify = vi.fn().mockResolvedValue(undefined);
    input.runtimeAudit = { log }; input.hitlNotifications = { notifyApprovalRequested: notify };
    const waiting = awaitToolConfirmation(input);
    await vi.waitFor(() => expect(input.pending.size).toBe(1));
    const pending = [...input.pending.values()][0]!;
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ eventName: 'tool.confirmation.requested',
      status: 'waiting_for_human', data: expect.objectContaining({ requestId: pending.payload.requestId, message: input.policyReason }) }));
    expect(notify).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requestId: pending.payload.requestId, policyReason: input.policyReason }));
    expect(pending.payload).toHaveProperty('policyReason', input.policyReason);
    expect(input.logConfirmationLifecycle).not.toHaveBeenCalled();
    pending.reject('human rejection'); expect(await waiting).toMatchObject({ status: 'rejected', message: 'human rejection' });
  });
  it.each(['', ' ', 'x'.repeat(2049)])('omits an invalid or oversized annotation without changing the wait', async policyReason => {
    const { input } = fixture(); input.policyReason = policyReason;
    const log = vi.fn().mockResolvedValue('audit'); input.runtimeAudit = { log };
    const waiting = awaitToolConfirmation(input); await vi.waitFor(() => expect(input.pending.size).toBe(1));
    expect(log.mock.calls[0]![0].data).not.toHaveProperty('message');
    const pending = [...input.pending.values()][0]!; pending.reject(); expect(await waiting).toHaveProperty('status', 'rejected');
  });
  it.each(['approve', 'reject'] as const)('preserves ordering and %s settlement', async action => {
    const { input, order } = fixture();
    const waiting = awaitToolConfirmation(input);
    await vi.waitFor(() => expect(input.pending.size).toBe(1));
    expect(order).toEqual(['waiting', 'emit']);
    const pending = [...input.pending.values()][0]!;
    expect(pending.payload.timeoutMs).toBe(0);
    if (action === 'approve') pending.resolve(); else pending.reject('reason');
    expect(await waiting).toEqual({ requestId: pending.payload.requestId,
      status: action === 'approve' ? 'approved' : 'rejected', ...(action === 'reject' ? { message: 'reason' } : {}) });
  });

  it.each([false, true])('preserves abort callbacks (already aborted=%s)', async alreadyAborted => {
    const { input, controller } = fixture();
    if (alreadyAborted) controller.abort();
    const waiting = awaitToolConfirmation(input);
    if (!alreadyAborted) {
      await vi.waitFor(() => expect(input.pending.size).toBe(1));
      controller.abort();
    }
    expect(await waiting).toMatchObject({ status: 'rejected' });
    expect(input.pending.size).toBe(0);
    expect(input.emitConfirmationInvalidated).toHaveBeenCalledWith(expect.anything(), 'cancelled', 'Tool confirmation aborted for tool.');
    expect(input.logConfirmationLifecycle).toHaveBeenCalledWith(expect.anything(), 'hitl_approval_cancelled', 'abort');
    expect(input.logRuntimeConfirmation).toHaveBeenCalledWith(expect.anything(), 'tool.confirmation.cancelled', 'cancelled');
  });
});

describe('verified durable manual wait lifetime', () => {
  it.each(['approve', 'reject', 'abort', 'checkpoint failure', 'announcement failure', 'acquisition failure',
    'persistence failure', 'cancel persistence false', 'cancel persistence failure'] as const)(
    'balances the timing scope on %s before returning to the approval consumer', async action => {
      const f = fixture();
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
      if (action === 'persistence failure') vi.spyOn(requests, 'create').mockRejectedValue(new Error('storage unavailable'));
      if (action === 'cancel persistence false') vi.spyOn(requests, 'resolve').mockResolvedValue(false);
      if (action === 'cancel persistence failure') vi.spyOn(requests, 'resolve').mockRejectedValue(new Error('storage unavailable'));
      f.input.hitlRequests = requests;
      const release = vi.fn(() => { f.order.push('release'); });
      let id = '';
      const begin = vi.fn((requestId: string) => {
        id = requestId;
        expect(sqlite.prepare('SELECT status FROM hitl_requests WHERE id = ?').get(id)).toEqual({ status: 'pending' });
        f.order.push('begin');
        if (action === 'acquisition failure') throw new Error('stale owner');
        return release;
      });
      Object.assign(f.input.ctx, { beginManualToolWait: begin,
        markWaitingForHuman: async () => {
          f.order.push('waiting');
          if (action === 'checkpoint failure' || action.startsWith('cancel persistence')) throw new Error('checkpoint failed');
        },
        emit: () => { f.order.push('emit'); if (action === 'announcement failure') throw new Error('announce failed'); },
      });
      try {
        const waiting = awaitToolConfirmation(f.input);
        const settled = waiting.then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
        if (action === 'approve' || action === 'reject' || action === 'abort') {
          await vi.waitFor(() => expect(f.input.pending.size).toBe(1));
          expect(f.order).toEqual(['begin', 'waiting', 'emit']);
          expect(release).not.toHaveBeenCalled();
          if (action === 'abort') f.controller.abort();
          else {
            const pending = [...f.input.pending.values()][0]!;
            if (action === 'approve') pending.resolve(); else pending.reject();
          }
        }
        const result = await settled;
        expect(begin).toHaveBeenCalledTimes(action === 'persistence failure' ? 0 : 1);
        expect(release).toHaveBeenCalledTimes(action === 'acquisition failure' || action === 'persistence failure' ? 0 : 1);
        if (action.includes('failure') || action === 'cancel persistence false') {
          expect(result.error).toBeInstanceOf(Error);
          if (action !== 'persistence failure') {
            expect((await requests.getById(id))?.status).toBe(action.startsWith('cancel persistence') ? 'pending' : 'cancelled');
          }
          if (action.startsWith('cancel persistence')) expect(f.input.logger.error).toHaveBeenCalled();
        } else expect(result.value?.status).toBe(action === 'approve' ? 'approved' : 'rejected');
      } finally { sqlite.close(); }
    },
  );
});

async function captured(change?: (input: ToolConfirmationWaitInput, requests: HitlRequestService) => void) {
  const f = fixture();
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
  Object.assign(f.input.ctx, { runId: 'run', turnId: 'turn', promptMessageId: 'prompt' });
  f.input.toolName = 'run_sub_agentflow';
  f.input.args = { nested: { values: ['original'] } };
  f.input.hitlRequests = requests;
  change?.(f.input, requests);
  try {
    const waiting = awaitToolConfirmation(f.input);
    await vi.waitFor(() => expect(f.input.pending.size).toBe(1));
    const pending = [...f.input.pending.values()][0]!;
    pending.resolve();
    expect(await waiting).toMatchObject({ status: 'approved' });
    return { ...f, pending, row: await requests.getById(pending.payload.requestId) };
  } finally { sqlite.close(); }
}

describe('live launch source capture', () => {
  it('captures the original source before waiting callbacks can mutate it', async () => {
    const f = await captured(input => {
      Object.defineProperty(input.ctx, 'markWaitingForHuman', { value: async () => {
        Object.defineProperty(input.ctx, 'runId', { value: 'mutated' });
        input.args['nested'] = { values: ['mutated'] };
      } });
    });
    expect(f.pending.source).toEqual({ runId: 'run', sessionId: 'session', turnId: 'turn',
      promptMessageId: 'prompt', assistantMessageId: 'message', toolCallId: 'call',
      toolName: 'run_sub_agentflow', args: { nested: { values: ['original'] } }, pendingRequestRevision: 1 });
    expect(f.pending.sourceAbortSignal).toBe(f.controller.signal);
    expect(f.row?.revision).toBe(f.pending.source?.pendingRequestRevision);
    expect(Object.isFrozen(f.pending.source)).toBe(true);
    expect(Object.isFrozen(f.pending.source?.args)).toBe(true);
    const nested = f.pending.source?.args['nested'] as { values: string[] };
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.values)).toBe(true);
    expect(() => nested.values.push('changed')).toThrow();
    expect(Reflect.set(f.pending, 'source', undefined)).toBe(false);
    expect(Reflect.set(f.pending, 'sourceAbortSignal', new AbortController().signal)).toBe(false);
  });

  it.each(['runId', 'turnId', 'promptMessageId', 'messageId'])('omits incomplete source without changing waiting: %s', async key => {
    const f = await captured(input => { Reflect.deleteProperty(input.ctx, key); });
    expect(f.pending.source).toBeUndefined();
    expect(f.pending.sourceAbortSignal).toBeUndefined();
  });

  it('does not invoke newly inspected source getters', async () => {
    const getter = vi.fn(() => 'prompt');
    // Persistence itself reads promptMessageId, so disable it for this descriptor test.
    const f = await captured(input => {
      input.hitlRequests = null;
      Object.defineProperty(input.ctx, 'messageId', { get: getter });
    });
    expect(f.pending.source).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(['runId', 'sessionId', 'turnId', 'toolCallId', 'payload', 'continuation', 'revision'])('rejects persisted source drift: %s', async key => {
    const f = await captured((_input, requests) => {
      const create = requests.create.bind(requests);
      vi.spyOn(requests, 'create').mockImplementation(async input => {
        const row = await create(input);
        return { ...row, [key]: key === 'revision' ? 0 : key === 'payload'
          ? { toolName: 'run_sub_agentflow', args: { changed: true } }
          : key === 'continuation' ? { ...row.continuation, messageId: 'foreign' } : 'foreign' };
      });
    });
    expect(f.pending.source).toBeUndefined();
  });

  it.each(['terminal_spawn', 'fs_read', 'unmarked'])('keeps other tools unmodified and without metadata: %s', async name => {
    const f = await captured(input => {
      input.toolName = name;
      input.args = { optional: undefined, negativeZero: -0, surrogate: '\ud800' };
    });
    expect(f.pending.source).toBeUndefined();
    expect(Object.hasOwn(f.pending.payload.args, 'optional')).toBe(true);
    expect(Object.is(f.pending.payload.args['negativeZero'], -0)).toBe(true);
  });

  it('keeps legacy undefined launch arguments waiting but without source', async () => {
    const f = await captured(input => { input.args = { optional: undefined }; });
    expect(f.pending.source).toBeUndefined();
  });

  it.each(['accessor', 'proxy'])('does not inspect dangerous arguments through user code: %s', async kind => {
    const trap = vi.fn(() => { throw new Error('must not execute'); });
    const f = await captured(input => {
      input.hitlRequests = null;
      input.args = kind === 'proxy' ? new Proxy({}, { ownKeys: trap, get: trap, getOwnPropertyDescriptor: trap })
        : Object.defineProperty({}, 'secret', { get: trap, enumerable: true });
    });
    expect(f.pending.source).toBeUndefined();
    expect(trap).not.toHaveBeenCalled();
  });

  it('rejects a persisted continuation accessor without invoking it', async () => {
    const getter = vi.fn(() => ({ messageId: 'message' }));
    const f = await captured((_input, requests) => {
      const create = requests.create.bind(requests);
      vi.spyOn(requests, 'create').mockImplementation(async input => {
        const row = await create(input);
        Object.defineProperty(row, 'continuation', { get: getter });
        return row;
      });
    });
    expect(f.pending.source).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects call/name mismatch in persisted payload', async () => {
    const f = await captured((_input, requests) => {
      const create = requests.create.bind(requests);
      vi.spyOn(requests, 'create').mockImplementation(async input => {
        const row = await create(input);
        return { ...row, payload: { ...row.payload, toolName: 'terminal_spawn' } };
      });
    });
    expect(f.pending.source).toBeUndefined();
  });

  it('does not bind valid but nonpersisted source', async () => {
    const f = await captured(input => { input.hitlRequests = null; });
    expect(f.pending.source).toBeUndefined();
    expect(f.pending.sourceAbortSignal).toBeUndefined();
  });

  it('does not share source objects across waits', async () => {
    const a = await captured(); const b = await captured();
    expect(a.pending.source).toBeDefined();
    expect(a.pending.source).not.toBe(b.pending.source);
    expect(a.pending.source?.args).not.toBe(b.pending.source?.args);
  });

  it('does not synthesize metadata for seeded diagnostic confirmations', () => {
    const service = new ToolConfirmationService(null, null);
    service.seedPendingConfirmation({ requestId: 'seed', sessionId: 'session', toolCallId: 'call',
      toolName: 'run_sub_agentflow', args: {}, timeoutMs: 0, turnId: 'turn', promptMessageId: 'prompt' });
    const pending = Reflect.get(service, 'pending') as Map<string, PendingConfirmation>;
    expect(pending.get('seed')?.source).toBeUndefined();
    expect(pending.get('seed')?.sourceAbortSignal).toBeUndefined();
    expect(service.getPendingConfirmations('session')).toHaveLength(1);
  });
});
