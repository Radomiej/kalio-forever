import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { methods, type ClientConnection, type SessionConfigOption } from '@agentclientprotocol/sdk';
import { DevinAcpHost } from './devin-cli-acp.host';
import { DevinAcpIdleTimeoutError } from './devin-cli-acp.execution-guard';

const modelOptions = (): SessionConfigOption[] => [{
  id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'swe-2',
  options: [{ value: 'swe-2', name: 'SWE-2' }],
}];

/** Fake ACP peer: session/new hands out acp-1, acp-2...; the first session/prompt never answers, even after session/cancel. */
function fakePeer(options: { answerCancel?: boolean } = {}) {
  let created = 0;
  const pending = new Map<string, (value: { stopReason: string }) => void>();
  const prompts: string[] = [];
  const request = vi.fn(async (method: string, params: { sessionId?: string }) => {
    if (method === methods.agent.session.new) return { sessionId: `acp-${++created}`, configOptions: modelOptions() };
    if (method === methods.agent.session.setConfigOption) return { configOptions: modelOptions() };
    if (method === methods.agent.session.prompt) {
      prompts.push(params.sessionId!);
      if (params.sessionId === 'acp-1') return new Promise<{ stopReason: string }>((done) => { pending.set('acp-1', done); });
      return { stopReason: 'end_turn' };
    }
    throw new Error(`unexpected ${method}`);
  });
  const notify = vi.fn(async (method: string, params: { sessionId: string }) => {
    if (options.answerCancel && method === methods.agent.session.cancel) pending.get(params.sessionId)?.({ stopReason: 'cancelled' });
  });
  const host = new DevinAcpHost('swe-2');
  const internals = host as unknown as { connection: ClientConnection; processEpoch: string };
  internals.connection = { signal: new AbortController().signal, agent: { request, notify } } as unknown as ClientConnection;
  internals.processEpoch = 'epoch';
  const input = () => ({ onText: vi.fn(), onThought: vi.fn(), onPermission: async () => 'decline' as const });
  return { host, request, notify, prompts, input };
}

describe('Devin ACP idle timeout recovery', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('sends session/cancel on idle timeout and reports the last ACP update', async () => {
    vi.stubEnv('DEVIN_ACP_IDLE_TIMEOUT_MS', '40');
    vi.stubEnv('DEVIN_ACP_CANCEL_SETTLE_MS', '60');
    const peer = fakePeer();
    const session = await peer.host.ensureSession(resolve('ws'), undefined);
    const turn = peer.input();
    const error = await peer.host.prompt(session.sessionId, 'one', turn).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DevinAcpIdleTimeoutError);
    expect((error as Error).message).toMatch(/last ACP update: none \(since prompt sent\) at \d{4}-/);
    expect(peer.notify).toHaveBeenCalledWith(methods.agent.session.cancel, { sessionId: 'acp-1' });
  });

  it('moves the next prompt to a fresh ACP session when the cancelled prompt never settles', async () => {
    vi.stubEnv('DEVIN_ACP_IDLE_TIMEOUT_MS', '40');
    vi.stubEnv('DEVIN_ACP_CANCEL_SETTLE_MS', '60');
    const peer = fakePeer();
    const first = await peer.host.ensureSession(resolve('ws'), undefined);
    await expect(peer.host.prompt(first.sessionId, 'one', peer.input())).rejects.toBeInstanceOf(DevinAcpIdleTimeoutError);
    const second = await peer.host.ensureSession(resolve('ws'), first.sessionId);
    expect(second.sessionId).toBe('acp-2');
    expect(second.resumed).toBe(false);
    await expect(peer.host.prompt(second.sessionId, 'two', peer.input())).resolves.toBe('end_turn');
    expect(peer.prompts).toEqual(['acp-1', 'acp-2']);
  });

  it('keeps the ACP session when Devin answers the cancelled prompt', async () => {
    vi.stubEnv('DEVIN_ACP_IDLE_TIMEOUT_MS', '40');
    vi.stubEnv('DEVIN_ACP_CANCEL_SETTLE_MS', '500');
    const peer = fakePeer({ answerCancel: true });
    const first = await peer.host.ensureSession(resolve('ws'), undefined);
    await expect(peer.host.prompt(first.sessionId, 'one', peer.input())).rejects.toBeInstanceOf(DevinAcpIdleTimeoutError);
    const again = await peer.host.ensureSession(resolve('ws'), first.sessionId);
    expect(again.sessionId).toBe('acp-1');
  });
});