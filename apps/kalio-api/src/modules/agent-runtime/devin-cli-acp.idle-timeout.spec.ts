import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { methods, type ClientConnection } from '@agentclientprotocol/sdk';
import { DevinAcpIdleTimeoutError, resolveDevinAcpIdleLimits, runGuardedDevinPrompt, type ActiveDevinTurn } from './devin-cli-acp.execution-guard';
import type { DevinAcpPromptInput } from './devin-cli-acp.host';

const limits = { idleMs: 1000, toolMs: 5000, cancelSettleMs: 200 };

function setup() {
  let resolvePrompt!: (value: { stopReason: 'end_turn' }) => void;
  const request = vi.fn(() => new Promise<{ stopReason: 'end_turn' }>((resolve) => { resolvePrompt = resolve; }));
  const notify = vi.fn(async () => undefined);
  const connection = { agent: { request, notify } } as unknown as ClientConnection;
  const session: { active?: ActiveDevinTurn; poisoned?: boolean } = {};
  const onPermission = vi.fn<DevinAcpPromptInput['onPermission']>(async () => 'accept');
  const input: DevinAcpPromptInput = { onText: vi.fn(), onThought: vi.fn(), onToolActivity: vi.fn(), onPermission };
  const turn = runGuardedDevinPrompt(connection, session, 'sid', 'prompt', input, undefined, limits);
  const settled = turn.then(() => 'ok', (error: unknown) => error);
  return { session, notify, onPermission, request, settled, resolve: () => resolvePrompt({ stopReason: 'end_turn' }) };
}

describe('Devin ACP idle watchdog', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fails a silent turn with LLM_TIMEOUT, cancels the session and clears the active turn', async () => {
    const f = setup();
    await vi.advanceTimersByTimeAsync(1001 + 300);
    const error = await f.settled;
    expect(error).toBeInstanceOf(DevinAcpIdleTimeoutError);
    expect(f.session.poisoned).toBe(true);
    expect((error as DevinAcpIdleTimeoutError).code).toBe('LLM_TIMEOUT');
    expect((error as Error).message).toContain('DEVIN_ACP_IDLE_TIMEOUT');
    expect(f.notify).toHaveBeenCalledWith(methods.agent.session.cancel, { sessionId: 'sid' });
    expect(f.session.active).toBeUndefined();
  });

  it('is re-armed by every ACP update', async () => {
    const f = setup();
    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(800);
      f.session.active!.onText('chunk');
    }
    await vi.advanceTimersByTimeAsync(800);
    expect(f.session.active).toBeDefined();
    f.resolve();
    await expect(f.settled).resolves.toBe('ok');
  });

  it('uses the longer tool budget while a tool call is in progress, and the short one after it completes', async () => {
    const f = setup();
    f.session.active!.onToolActivity!({ toolCallId: 't1', status: 'in_progress' });
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.session.active).toBeDefined();
    f.session.active!.onToolActivity!({ toolCallId: 't1', status: 'completed' });
    await vi.advanceTimersByTimeAsync(1001 + 300);
    const error = await f.settled;
    expect(error).toBeInstanceOf(DevinAcpIdleTimeoutError);
    expect((error as DevinAcpIdleTimeoutError).toolInProgress).toBe(false);
  });

  it('is paused while a permission decision is pending and re-armed after it', async () => {
    const f = setup();
    let decide!: (value: 'accept') => void;
    f.onPermission.mockImplementation(() => new Promise<'accept'>((resolve) => { decide = resolve; }));
    const answer = f.session.active!.onPermission({ sessionId: 'sid', toolCall: { toolCallId: 't1' }, options: [] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.session.active).toBeDefined();
    decide('accept');
    await expect(answer).resolves.toBe('accept');
    await vi.advanceTimersByTimeAsync(1001 + 300);
    expect(await f.settled).toBeInstanceOf(DevinAcpIdleTimeoutError);
  });
  it('can be disabled with 0 and reads limits from the environment', async () => {
    expect(resolveDevinAcpIdleLimits({ DEVIN_ACP_IDLE_TIMEOUT_MS: '0', DEVIN_ACP_TOOL_IDLE_TIMEOUT_MS: '42' })).toEqual({ idleMs: 0, toolMs: 42, cancelSettleMs: 10_000 });
    expect(resolveDevinAcpIdleLimits({ DEVIN_ACP_IDLE_TIMEOUT_MS: 'bad' })).toEqual({ idleMs: 300_000, toolMs: 1_800_000, cancelSettleMs: 10_000 });
  });
});
