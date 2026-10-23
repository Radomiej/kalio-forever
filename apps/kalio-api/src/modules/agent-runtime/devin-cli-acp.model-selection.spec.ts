import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { methods, type ClientConnection, type SessionConfigOption, type SessionNotification } from '@agentclientprotocol/sdk';
import { DevinAcpHost } from './devin-cli-acp.host';
import { bindDevinSessionModel, devinAcpChildEnv } from './devin-cli-acp.model-selection';

const options = (currentValue = 'swe-2'): SessionConfigOption[] => [{
  id: 'model', name: 'Model', category: 'model', type: 'select', currentValue,
  options: [{ value: 'swe-2', name: 'SWE-2' }, { value: 'swe-2-high', name: 'SWE-2 High' }],
}];

function setup(configOptions: SessionConfigOption[] | undefined, restore?: 'resume' | 'load', model = 'swe-2') {
  const request = vi.fn().mockImplementation(async (method: string) => {
    if (method === methods.agent.session.prompt) return { stopReason: 'end_turn' };
    return { sessionId: 'thread', configOptions };
  });
  const host = new DevinAcpHost(model);
  const internals = host as unknown as {
    connection: ClientConnection; processEpoch: string; capabilities: object;
    handleSessionUpdate(params: SessionNotification): void;
  };
  internals.connection = { signal: new AbortController().signal, agent: { request } } as unknown as ClientConnection;
  internals.processEpoch = 'epoch';
  internals.capabilities = restore === 'resume' ? { sessionCapabilities: { resume: {} } } : { loadSession: true };
  const ensure = () => host.ensureSession(resolve('model-workspace'), restore ? 'thread' : undefined);
  const prompt = () => host.prompt('thread', 'test', { onText: vi.fn(), onThought: vi.fn(), onPermission: async () => 'decline' });
  return { host, internals, request, ensure, prompt };
}

describe('Devin exact session model binding', () => {
  for (const duringSetter of [false, true]) {
    it(`distinguishes initial GLM notification from drift during setter (${duringSetter})`, async () => {
      const test = setup(options('glm-5-2'), undefined, 'swe-2-high');
      const update = () => test.internals.handleSessionUpdate({ sessionId: 'thread', update: {
        sessionUpdate: 'config_option_update', configOptions: options('glm-5-2'),
      } });
      test.request.mockImplementation(async (method: string) => {
        if (method === methods.agent.session.new) {
          update();
          return { sessionId: 'thread', configOptions: options('glm-5-2') };
        }
        if (method === methods.agent.session.setConfigOption) {
          if (duringSetter) update();
          return { configOptions: options('swe-2-high') };
        }
        return { stopReason: 'end_turn' };
      });
      if (duringSetter) {
        await expect(test.ensure()).rejects.toThrow(/model/i);
        await expect(test.prompt()).rejects.toThrow();
      } else {
        await expect(test.ensure()).resolves.toMatchObject({ sessionId: 'thread' });
      }
      expect(test.request.mock.calls.some(([method]) => method === methods.agent.session.prompt)).toBe(false);
    });
  }
  it('identifies a stale setter response with bounded current-model diagnostics', async () => {
    const request = vi.fn().mockResolvedValue({ configOptions: options('glm-5-2') });
    await expect(bindDevinSessionModel({ agent: { request } } as unknown as ClientConnection,
      'thread', 'swe-2-high', options('glm-5-2'))).rejects.toThrow('"source":"setter_response"');
    await expect(bindDevinSessionModel({ agent: { request } } as unknown as ClientConnection,
      'thread', 'swe-2-high', options('glm-5-2'))).rejects.toThrow('"current":"glm-5-2"');
  });
  it('reports bounded model-only diagnostics without exposing metadata or other config', async () => {
    const config: SessionConfigOption[] = [{ id: 'model', category: 'model', type: 'select', name: 'Model',
      currentValue: 'glm-5-2-high', _meta: { private: 'DO_NOT_EXPOSE' }, options: [
        { value: 'canonical-swe', name: 'SWE-2', description: 'DO_NOT_EXPOSE' },
        { value: 'glm-5-2-high', name: 'GLM-5.2 High' },
      ] }, { id: 'secret', type: 'select', name: 'Other', currentValue: 'DO_NOT_EXPOSE', options: [] }];
    const test = setup(config);
    let message = '';
    try { await test.ensure(); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('canonical-swe');
    expect(message).toContain('glm-5-2-high');
    expect(message).not.toContain('DO_NOT_EXPOSE');
    expect(message.length).toBeLessThan(5000);
    expect(test.request).toHaveBeenCalledTimes(1);
  });
  it('removes refusal fallback case-insensitively without mutating the parent environment', () => {
    const env = { DEVIN_REFUSAL_FALLBACK: 'fixture', devin_refusal_fallback: 'fixture', PATH: 'path' };
    expect(devinAcpChildEnv(env)).toEqual({ PATH: 'path' });
    expect(Object.keys(env)).toHaveLength(3);
  });
  it('removes control-plane credentials but preserves scoped MCP configuration', () => {
    const env = { KALIO_CONTROL_PLANE_TOKEN: 'fixture', kalio_control_plane_token: 'fixture',
      KALIO_MCP_TOKEN: 'scoped-fixture', DEVIN_CONFIG: 'fixture-config' };
    expect(devinAcpChildEnv(env)).toEqual({ KALIO_MCP_TOKEN: 'scoped-fixture', DEVIN_CONFIG: 'fixture-config' });
    expect(Object.keys(env)).toHaveLength(4);
  });
  it('accepts confirmed exact selection from grouped options', async () => {
    const confirmed = options();
    const selector = confirmed[0];
    if (selector.type !== 'select') throw new Error('fixture');
    selector.options = [{ group: 'models', name: 'Models', options: [{ value: 'swe-2', name: 'SWE-2' }] }];
    const request = vi.fn().mockResolvedValue({ configOptions: confirmed });
    const connection = { agent: { request } } as unknown as ClientConnection;
    await expect(bindDevinSessionModel(connection, 'thread', 'swe-2', options('swe-2-high'))).resolves.toEqual(confirmed);
  });
  for (const invalid of [[], [...options(), ...options()], [{ ...options()[0], options: [{ value: 'swe-2-high', name: 'SWE-2' }] }],
    [{ ...options()[0], options: [{ value: 'swe-2', name: 'A' }, { value: 'swe-2', name: 'B' }] }]] as SessionConfigOption[][]) {
    it('blocks missing, ambiguous, and non-exact metadata without a prompt', async () => {
      const test = setup(invalid);
      await expect(test.ensure()).rejects.toThrow(/model/i);
      await expect(test.prompt()).rejects.toThrow();
      expect(test.request.mock.calls.some(([method]) => method === methods.agent.session.prompt)).toBe(false);
    });
  }
  it('propagates unsupported setter and never registers a promptable session', async () => {
    const test = setup(options('swe-2-high'));
    test.request.mockImplementation(async (method: string) => {
      if (method === methods.agent.session.setConfigOption) throw new Error('Unsupported model setter');
      return { sessionId: 'thread', configOptions: options('swe-2-high') };
    });
    await expect(test.ensure()).rejects.toThrow('Unsupported model setter');
    await expect(test.prompt()).rejects.toThrow();
    expect(test.request.mock.calls.some(([method]) => method === methods.agent.session.prompt)).toBe(false);
  });
  it('rejects changed selector identity even when the exact value is returned', async () => {
    const request = vi.fn().mockResolvedValue({ configOptions: [{ ...options()[0], id: 'replacement' }] });
    await expect(bindDevinSessionModel({ agent: { request } } as unknown as ClientConnection,
      'thread', 'swe-2', options('swe-2-high'))).rejects.toThrow('selector changed');
  });
  for (const restore of [undefined, 'resume', 'load'] as const) {
    it(`blocks ${restore ?? 'new'} without model metadata`, async () => {
      const test = setup(undefined, restore);
      await expect(test.ensure()).rejects.toThrow(/model/i);
      await expect(test.prompt()).rejects.toThrow();
      expect(test.request.mock.calls.some(([method]) => method === methods.agent.session.prompt)).toBe(false);
    });
    it(`accepts exact model for ${restore ?? 'new'}`, async () => {
      const test = setup(options(), restore);
      await test.ensure();
      await expect(test.prompt()).resolves.toBe('end_turn');
    });
  }
  it('requires setter confirmation instead of trusting a successful RPC', async () => {
    const test = setup(options('swe-2-high'));
    await expect(test.ensure()).rejects.toThrow(/model/i);
    expect(test.request).toHaveBeenCalledWith(methods.agent.session.setConfigOption, {
      sessionId: 'thread', configId: 'model', value: 'swe-2',
    });
  });
  for (const restore of [undefined, 'resume', 'load'] as const) {
    it(`switches GLM to exact swe-2 before prompting on ${restore ?? 'new'}`, async () => {
      const test = setup(options('glm-5-2'), restore);
      test.request.mockImplementation(async (method: string) => {
        if (method === methods.agent.session.prompt) return { stopReason: 'end_turn' };
        if (method === methods.agent.session.setConfigOption) return { configOptions: options() };
        return { sessionId: 'thread', configOptions: options('glm-5-2') };
      });
      await test.ensure();
      expect(test.request).toHaveBeenCalledWith(methods.agent.session.setConfigOption, {
        sessionId: 'thread', configId: 'model', value: 'swe-2',
      });
      expect(test.request.mock.calls.some(([method]) => method === methods.agent.session.prompt)).toBe(false);
      await expect(test.prompt()).resolves.toBe('end_turn');
    });
  }
  it('blocks cached drift observed outside an active turn', async () => {
    const test = setup(options());
    await test.ensure();
    test.internals.handleSessionUpdate({ sessionId: 'thread', update: {
      sessionUpdate: 'config_option_update', configOptions: options('swe-2-high'),
    } });
    await expect(test.host.ensureSession(resolve('model-workspace'), 'thread')).rejects.toThrow(/model/i);
    await expect(test.prompt()).rejects.toThrow(/model/i);
    expect(test.request.mock.calls.some(([method]) => method === methods.agent.session.prompt)).toBe(false);
  });
  it('cancels an active provider request on drift and rejects the turn', async () => {
    const test = setup(options());
    const notify = vi.fn().mockResolvedValue(undefined);
    const close = vi.spyOn(test.host, 'close').mockResolvedValue(undefined);
    test.internals.connection.agent.notify = notify;
    await test.ensure();
    test.request.mockImplementation(() => new Promise(() => undefined));
    const turn = test.prompt();
    const rejected = expect(turn).rejects.toThrow(/model/i);
    await vi.waitFor(() => expect(test.request).toHaveBeenCalledWith(methods.agent.session.prompt, expect.anything(), undefined));
    test.internals.handleSessionUpdate({ sessionId: 'thread', update: {
      sessionUpdate: 'config_option_update', configOptions: options('swe-2-high'),
    } });
    await rejected;
    expect(notify).toHaveBeenCalledWith(methods.agent.session.cancel, { sessionId: 'thread' });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    await expect(test.prompt()).rejects.toThrow(/model/i);
  });
  it('blocks early drift instead of overwriting it with an older new-session response', async () => {
    const test = setup(options());
    test.internals.handleSessionUpdate({ sessionId: 'thread', update: {
      sessionUpdate: 'config_option_update', configOptions: options('swe-2-high'),
    } });
    await expect(test.ensure()).rejects.toThrow(/model/i);
    await expect(test.prompt()).rejects.toThrow();
    expect(test.request.mock.calls.some(([method]) => method === methods.agent.session.prompt)).toBe(false);
  });
  it('closes the host even when drift cancellation rejects', async () => {
    const test = setup(options());
    const close = vi.spyOn(test.host, 'close').mockResolvedValue(undefined);
    test.internals.connection.agent.notify = vi.fn().mockRejectedValue(new Error('fixture cancellation failure'));
    await test.ensure();
    test.request.mockImplementation(() => new Promise(() => undefined));
    const rejected = expect(test.prompt()).rejects.toThrow(/model/i);
    await vi.waitFor(() => expect(test.request).toHaveBeenCalledWith(methods.agent.session.prompt, expect.anything(), undefined));
    test.internals.handleSessionUpdate({ sessionId: 'thread', update: {
      sessionUpdate: 'config_option_update', configOptions: [],
    } });
    await rejected;
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
  it('keeps verified metadata isolated from mutation of the RPC response', async () => {
    const metadata = options();
    const test = setup(metadata);
    await test.ensure();
    metadata[0].currentValue = 'swe-2-high';
    await expect(test.prompt()).resolves.toBe('end_turn');
  });
  it('drains the host without waiting for a stalled cancellation write', async () => {
    const test = setup(options());
    const close = vi.spyOn(test.host, 'close').mockResolvedValue(undefined);
    test.internals.connection.agent.notify = vi.fn().mockImplementation(() => new Promise(() => undefined));
    await test.ensure();
    test.request.mockImplementation(() => new Promise(() => undefined));
    const rejected = expect(test.prompt()).rejects.toThrow(/model/i);
    await vi.waitFor(() => expect(test.request).toHaveBeenCalledWith(methods.agent.session.prompt, expect.anything(), undefined));
    test.internals.handleSessionUpdate({ sessionId: 'thread', update: {
      sessionUpdate: 'config_option_update', configOptions: options('swe-2-high'),
    } });
    await rejected;
    expect(close).toHaveBeenCalledOnce();
  });
});
