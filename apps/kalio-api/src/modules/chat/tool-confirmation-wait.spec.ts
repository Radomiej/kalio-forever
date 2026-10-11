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
