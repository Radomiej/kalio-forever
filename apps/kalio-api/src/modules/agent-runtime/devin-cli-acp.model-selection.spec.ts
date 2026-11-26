import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { methods, type ClientConnection, type SessionConfigOption, type SessionNotification } from '@agentclientprotocol/sdk';
import { DevinAcpHost } from './devin-cli-acp.host';
import { assertDevinSessionModel, bindDevinSessionModel, DevinModelBindingError, devinAcpChildEnv, expandDevinModelVariants, readDevinSelectableModels } from './devin-cli-acp.model-selection';

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
  it('reproduces the 122-option audit: Medium is not a standalone model or a reasoning alias', async () => {
    const modelOptions = [
      { value: 'glm-5-2', name: 'GLM-5.2' },
      { value: 'swe-2-high', name: 'SWE-2' },
      { value: 'fusion-gpt-6-sol-high-sidekick-swe-2-medium', name: 'Fusion (SWE-2 Medium)' },
      ...Array.from({ length: 119 }, (_, index) => ({ value: `fixture-${index}`, name: `Fixture ${index}` })),
    ];
    const metadata: SessionConfigOption[] = [{
      id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'glm-5-2',
      options: [{ group: 'models', name: 'Models', options: modelOptions }],
    }, {
      id: 'reasoning', name: 'Reasoning', category: 'thought_level', type: 'select', currentValue: 'high',
      options: [{ value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }],
    }];
    expect(readDevinSelectableModels(metadata)).toEqual(modelOptions.map(option => option.value));
    expect(readDevinSelectableModels(metadata)).toHaveLength(122);
    expect(readDevinSelectableModels(metadata)).not.toContain('swe-2-medium');
    expect(readDevinSelectableModels(metadata)).not.toContain('medium');
    const test = setup(metadata, undefined, 'swe-2-medium');
    await expect(test.ensure()).rejects.toThrow('"exactMatches":0');
    await expect(test.prompt()).rejects.toThrow();
    // A level id is only bindable via the family's thought_level option; with none offered, nothing is ever prompted.
    expect(test.request.mock.calls.map(([method]) => method)).not.toContain(methods.agent.session.prompt);
  });

  it('rejects duplicate ACP catalog IDs instead of advertising an unbindable model', () => {
    const metadata = options();
    const selector = metadata[0];
    if (selector.type !== 'select') throw new Error('fixture');
    selector.options = [{ value: 'swe-2-high', name: 'A' }, { value: 'swe-2-high', name: 'B' }];
    expect(() => readDevinSelectableModels(metadata)).toThrow('catalog blocked');
    expect(() => readDevinSelectableModels([...options(), ...options()])).toThrow('ambiguous');
  });
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
      // A disagreeing notification is healed by exactly one rebind; the fresh setter response is authoritative.
      await expect(test.ensure()).resolves.toMatchObject({ sessionId: 'thread' });
      expect(test.request.mock.calls.filter(([method]) => method === methods.agent.session.setConfigOption)).toHaveLength(duringSetter ? 2 : 1);
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
  it('blocks cached drift observed outside an active turn when the rebind is not confirmed', async () => {
    const test = setup(options());
    await test.ensure();
    test.internals.handleSessionUpdate({ sessionId: 'thread', update: {
      sessionUpdate: 'config_option_update', configOptions: options('swe-2-high'),
    } });
    test.request.mockImplementation(async () => ({ sessionId: 'thread', configOptions: options('swe-2-high') }));
    await expect(test.host.ensureSession(resolve('model-workspace'), 'thread')).rejects.toBeInstanceOf(DevinModelBindingError);
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
    // The real close() clears the sessions; with close mocked, a later prompt may only rebind and must still fail on a mismatched setter response.
    test.request.mockImplementation(async () => ({ configOptions: options('swe-2-high') }));
    await expect(test.prompt()).rejects.toThrow(/model/i);
  });
  it('blocks early drift when the rebind setter response still disagrees', async () => {
    const test = setup(options());
    test.internals.handleSessionUpdate({ sessionId: 'thread', update: {
      sessionUpdate: 'config_option_update', configOptions: options('swe-2-high'),
    } });
    test.request.mockImplementation(async (method: string) => method === methods.agent.session.setConfigOption
      ? { configOptions: options('swe-2-high') } : { sessionId: 'thread', configOptions: options() });
    await expect(test.ensure()).rejects.toBeInstanceOf(DevinModelBindingError);
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

describe('Devin reasoning-level model variants', () => {
  const select = (id: string, category: string, currentValue: string, values: string[]): SessionConfigOption => ({
    id, name: id, category, type: 'select', currentValue, options: values.map(value => ({ value, name: value })),
  });
  const levels = ['low', 'medium', 'high', 'xhigh', 'max'];
  const acp = (model: string, level?: string): SessionConfigOption[] => [
    select('model', 'model', model, ['glm-5-2', 'swe-2-1-medium', 'swe-2-1-medium-lightning', 'fusion-x-sidekick-swe-2-1-medium']),
    ...(model === 'swe-2-1-medium' ? [select('thought_level', 'thought_level', level ?? 'medium', levels)] : []),
  ];

  it('expands every SWE-2.1 level from the single ACP entry, without lightning or fusion variants', () => {
    const models = readDevinSelectableModels(acp('glm-5-2'));
    const expanded = expandDevinModelVariants(models, new Map([['swe-2-1-medium', levels]]));
    expect(expanded).toEqual(expect.arrayContaining(['swe-2-1-low', 'swe-2-1-medium', 'swe-2-1-high', 'swe-2-1-xhigh', 'swe-2-1-max']));
    expect(expanded.filter(model => model.includes('lightning'))).toEqual(['swe-2-1-medium-lightning']);
    expect(expanded.filter(model => model.startsWith('fusion-'))).toEqual(['fusion-x-sidekick-swe-2-1-medium']);
    expect(new Set(expanded).size).toBe(expanded.length);
  });

  it('binds swe-2-1-high as swe-2-1-medium plus thought_level=high and asserts both', async () => {
    const request = vi.fn().mockImplementation(async (_method: string, params: { configId: string; value: string }) =>
      ({ configOptions: params.configId === 'model' ? acp(params.value) : acp('swe-2-1-medium', params.value) }));
    const connection = { signal: new AbortController().signal, agent: { request } } as unknown as ClientConnection;
    const bound = await bindDevinSessionModel(connection, 'thread', 'swe-2-1-high', acp('glm-5-2'));
    expect(request.mock.calls.map(([, params]) => [params.configId, params.value])).toEqual([
      ['model', 'swe-2-1-medium'], ['thought_level', 'high'],
    ]);
    expect(() => assertDevinSessionModel('swe-2-1-high', bound)).not.toThrow();
    expect(() => assertDevinSessionModel('swe-2-1-max', bound)).toThrow('differs');
    expect(() => assertDevinSessionModel('swe-2-1-high', acp('swe-2-1-medium', 'medium'))).toThrow('differs');
  });

  it('keeps unknown and lightning variants unavailable', async () => {
    const connection = { signal: new AbortController().signal, agent: { request: vi.fn() } } as unknown as ClientConnection;
    await expect(bindDevinSessionModel(connection, 'thread', 'swe-2-1-high-lightning', acp('glm-5-2'))).rejects.toThrow('unavailable');
    await expect(bindDevinSessionModel(connection, 'thread', 'nonexistent-high', acp('glm-5-2'))).rejects.toThrow('unavailable');
  });
});
describe('Devin model rebind after a stale config_option_update', () => {
  const levels = ['low', 'medium', 'high', 'xhigh', 'max'];
  const select = (id: string, category: string, currentValue: string, values: string[]): SessionConfigOption => ({
    id, name: id, category, type: 'select', currentValue, options: values.map(value => ({ value, name: value })),
  });
  const view = (model: string, level: string): SessionConfigOption[] => [
    select('model', 'model', model, ['glm-5-2', 'swe-2-1-medium']),
    ...(model === 'swe-2-1-medium' ? [select('thought_level', 'thought_level', level, levels)] : []),
  ];

  /** `stale` decides, per set call, whether a stale (base model, medium level) notification is delivered right after the setter answered. */
  function variantSetup(stale: (configId: string, sessionNo: number, thoughtCalls: number) => boolean, lastThoughtStaysMedium = false) {
    const state = { model: 'glm-5-2', level: 'medium' };
    let sessions = 0;
    const thoughtCalls: Record<string, number> = {};
    const host = new DevinAcpHost('swe-2-1-high');
    const internals = host as unknown as {
      connection: ClientConnection; processEpoch: string; capabilities: object;
      handleSessionUpdate(params: SessionNotification): void;
    };
    const request = vi.fn().mockImplementation(async (method: string, params: { sessionId: string; configId: string; value: string }) => {
      if (method === methods.agent.session.prompt) return { stopReason: 'end_turn' };
      if (method === methods.agent.session.new) { sessions += 1; state.model = 'glm-5-2'; state.level = 'medium'; return { sessionId: `thread-${sessions}`, configOptions: view(state.model, state.level) }; }
      const sessionNo = Number(params.sessionId.split('-')[1]);
      if (params.configId === 'model') state.model = params.value; else {
        thoughtCalls[params.sessionId] = (thoughtCalls[params.sessionId] ?? 0) + 1;
        state.level = lastThoughtStaysMedium && thoughtCalls[params.sessionId] > 1 ? 'medium' : params.value;
      }
      const response = view(state.model, state.level);
      if (stale(params.configId, sessionNo, thoughtCalls[params.sessionId] ?? 0)) {
        internals.handleSessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: 'config_option_update', configOptions: view('swe-2-1-medium', 'medium') } });
      }
      return { configOptions: response };
    });
    internals.connection = { signal: new AbortController().signal, agent: { request, notify: vi.fn().mockResolvedValue(undefined) } } as unknown as ClientConnection;
    internals.processEpoch = 'epoch';
    internals.capabilities = {};
    const sets = () => request.mock.calls.filter(([method]) => method === methods.agent.session.setConfigOption).map(([, params]) => `${params.configId}=${params.value}`);
    const prompt = (id: string) => host.prompt(id, 'test', { onText: vi.fn(), onThought: vi.fn(), onPermission: async () => 'decline' });
    return { host, internals, request, sets, prompt, ensure: () => host.ensureSession(resolve('model-workspace')) };
  }

  it('rebinds exactly once when a stale early update lands after the correct setter response', async () => {
    const test = variantSetup((configId, _no, thoughtCalls) => configId === 'thought_level' && thoughtCalls === 1);
    const session = await test.ensure();
    expect(session.sessionId).toBe('thread-1');
    expect(test.sets()).toEqual(['model=swe-2-1-medium', 'thought_level=high', 'thought_level=high']);
    await expect(test.prompt('thread-1')).resolves.toBe('end_turn');
    expect(test.sets()).toHaveLength(3);
  });

  it('fails with DevinModelBindingError after exactly one extra set sequence when the rebind is still mismatched', async () => {
    const test = variantSetup((configId, _no, thoughtCalls) => configId === 'thought_level' && thoughtCalls === 1, true);
    await expect(test.ensure()).rejects.toBeInstanceOf(DevinModelBindingError);
    expect(test.sets()).toEqual(['model=swe-2-1-medium', 'thought_level=high', 'thought_level=high']);
    expect(test.request.mock.calls.some(([method]) => method === methods.agent.session.prompt)).toBe(false);
  });

  it('rebinds once in promptNow when a stale update hit a registered idle session', async () => {
    const test = variantSetup(() => false);
    await test.ensure();
    expect(test.sets()).toHaveLength(2);
    test.internals.handleSessionUpdate({ sessionId: 'thread-1', update: { sessionUpdate: 'config_option_update', configOptions: view('swe-2-1-medium', 'medium') } });
    await expect(test.prompt('thread-1')).resolves.toBe('end_turn');
    expect(test.sets()).toEqual(['model=swe-2-1-medium', 'thought_level=high', 'thought_level=high']);
    await expect(test.prompt('thread-1')).resolves.toBe('end_turn');
    expect(test.sets()).toHaveLength(3);
  });

  it('still cancels the turn and closes the host on drift during an active prompt (no rebind)', async () => {
    const test = variantSetup(() => false);
    const close = vi.spyOn(test.host, 'close').mockResolvedValue(undefined);
    await test.ensure();
    test.request.mockImplementation(() => new Promise(() => undefined));
    const rejected = expect(test.prompt('thread-1')).rejects.toBeInstanceOf(DevinModelBindingError);
    await vi.waitFor(() => expect(test.request).toHaveBeenCalledWith(methods.agent.session.prompt, expect.anything(), undefined));
    test.internals.handleSessionUpdate({ sessionId: 'thread-1', update: { sessionUpdate: 'config_option_update', configOptions: view('swe-2-1-medium', 'medium') } });
    await rejected;
    expect(test.internals.connection.agent.notify).toHaveBeenCalledWith(methods.agent.session.cancel, { sessionId: 'thread-1' });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('survives the live bug: second session on a reused host with the model-set update delivered after the thought response', async () => {
    const test = variantSetup((configId, sessionNo, thoughtCalls) => sessionNo === 2 && configId === 'thought_level' && thoughtCalls === 1);
    await test.ensure();
    const second = await test.ensure();
    expect(second.sessionId).toBe('thread-2');
    await expect(test.prompt('thread-2')).resolves.toBe('end_turn');
    expect(test.sets()).toEqual([
      'model=swe-2-1-medium', 'thought_level=high',
      'model=swe-2-1-medium', 'thought_level=high', 'thought_level=high',
    ]);
  });

  it('includes the current thought level in the mismatch diagnostic', () => {
    expect(() => assertDevinSessionModel('swe-2-1-high', view('swe-2-1-medium', 'medium'))).toThrow('"thoughtLevel":"medium"');
  });
});
