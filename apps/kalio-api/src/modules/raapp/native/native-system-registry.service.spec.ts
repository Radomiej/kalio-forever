import { describe, it, expect, beforeEach } from 'vitest';
import { NativeSystemRegistry } from './native-system-registry.service';
import type { NativeSystem, NativeSessionContext } from './native-system-registry.service';

describe('NativeSystemRegistry', () => {
  let registry: NativeSystemRegistry;
  const ctx: NativeSessionContext = { sessionId: 'sess-test' };

  beforeEach(() => {
    registry = new NativeSystemRegistry();
  });

  describe('register()', () => {
    it('registers a system and returns it via get()', () => {
      const sys: NativeSystem = {
        id: 'test_sys',
        description: 'test',
        approval_required: false,
        input_schema: {},
        handler: async () => ({ ok: true }),
      };
      registry.register(sys);
      expect(registry.get('test_sys')).toBe(sys);
    });

    it('getAll() returns all registered systems', () => {
      const sys1: NativeSystem = { id: 'a', description: '', approval_required: false, input_schema: {}, handler: async () => null };
      const sys2: NativeSystem = { id: 'b', description: '', approval_required: true, input_schema: {}, handler: async () => null };
      registry.register(sys1);
      registry.register(sys2);
      expect(registry.getAll()).toHaveLength(2);
    });

    it('overwrites an existing system with the same id', () => {
      const sys1: NativeSystem = { id: 'dup', description: 'v1', approval_required: false, input_schema: {}, handler: async () => 'v1' };
      const sys2: NativeSystem = { id: 'dup', description: 'v2', approval_required: false, input_schema: {}, handler: async () => 'v2' };
      registry.register(sys1);
      registry.register(sys2);
      expect(registry.get('dup')?.description).toBe('v2');
    });
  });

  describe('execute()', () => {
    it('throws if system not found', async () => {
      await expect(registry.execute('nonexistent', {}, ctx)).rejects.toThrow(
        'NativeSystem "nonexistent" not found',
      );
    });

    it('executes a non-approval-required system and returns result', async () => {
      registry.register({
        id: 'add',
        description: 'adds',
        approval_required: false,
        input_schema: {},
        handler: async (args) => ({ sum: (args['a'] as number) + (args['b'] as number) }),
      });
      const res = await registry.execute('add', { a: 2, b: 3 }, ctx);
      expect(res.approval_required).toBe(false);
      expect(res.result).toEqual({ sum: 5 });
    });

    it('returns approval_required=true without calling handler for approval_required systems', async () => {
      let called = false;
      registry.register({
        id: 'risky',
        description: 'risky op',
        approval_required: true,
        input_schema: {},
        handler: async () => { called = true; return {}; },
      });
      const res = await registry.execute('risky', {}, ctx);
      expect(res.approval_required).toBe(true);
      expect(res.result).toBeNull();
      expect(called).toBe(false);
    });
  });

  describe('executeApproved()', () => {
    it('throws if system not found', async () => {
      await expect(registry.executeApproved('nonexistent', {}, ctx)).rejects.toThrow(
        'NativeSystem "nonexistent" not found',
      );
    });

    it('calls handler directly bypassing approval gate', async () => {
      let called = false;
      registry.register({
        id: 'risky',
        description: 'risky op',
        approval_required: true,
        input_schema: {},
        handler: async (args) => { called = true; return { done: true, arg: args['x'] }; },
      });
      const result = await registry.executeApproved('risky', { x: 42 }, ctx);
      expect(called).toBe(true);
      expect(result).toEqual({ done: true, arg: 42 });
    });
  });

  describe('get()', () => {
    it('returns undefined for unknown id', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });
  });
});
