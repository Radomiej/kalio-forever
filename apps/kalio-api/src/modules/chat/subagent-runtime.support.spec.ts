import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ActiveSubagentRunRegistry, type ActiveSubagentRunInput } from './subagent-runtime.support';

function input(turnId = 'turn'): ActiveSubagentRunInput {
  return { childSessionId: 'child', parentSessionId: 'parent', historySessionId: 'parent',
    vfsSessionId: 'parent', turnId, controller: new AbortController() };
}

describe('ActiveSubagentRunRegistry exclusive foundation (unwired)', () => {
  it('logs a static secondary close failure without a waiting drain and keeps normal completion quiet', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const registry = new ActiveSubagentRunRegistry();
      registry.registerExclusive(input())!.complete();
      expect(logged).not.toHaveBeenCalled();
      const supplied = input();
      const owner = registry.registerExclusive(supplied)!;
      registry.bindCancellationRecording('child', supplied.controller, () => ({ lookup: () => ({
        registerAdmission: async () => undefined, stop: vi.fn(), permitFor: () => null,
        close: () => { throw new Error('PRIVATE_CLEANUP_PAYLOAD'); },
      }) }));
      const primary = new Error('primary execution error');
      expect(() => { try { throw primary; } finally { owner.complete(); } }).toThrow(primary);
      expect(logged.mock.calls).toEqual([['SUBAGENT_RUN_CLEANUP_FAILED']]);
      expect(JSON.stringify(logged.mock.calls)).not.toContain('PRIVATE_CLEANUP_PAYLOAD');
      owner.complete();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(registry.getStatus('child')).toBeNull();
    } finally { logged.mockRestore(); }
  });
  it('claims synchronously and refuses both exclusive and ordinary overwrites', () => {
    const registry = new ActiveSubagentRunRegistry();
    const owner = registry.registerExclusive(input());
    expect(owner).not.toBeNull();
    expect(registry.registerExclusive(input('loser'))).toBeNull();
    expect(() => registry.register(input('ordinary'))).toThrow('SUBAGENT_RUN_EXCLUSIVE_CONFLICT');
    owner!.assertCurrent();
    expect(registry.getStatus('child')?.turnId).toBe('turn');
    owner!.complete();
  });

  it('refuses exclusive takeover of ordinary run and preserves ordinary replacement', () => {
    const registry = new ActiveSubagentRunRegistry();
    const oldRelease = registry.register(input('old'));
    expect(registry.registerExclusive(input())).toBeNull();
    const release = registry.register(input('new'));
    oldRelease();
    expect(registry.getStatus('child')?.turnId).toBe('new');
    release();
    expect(registry.getStatus('child')).toBeNull();
  });

  it('stale owner cleanup is idempotent and cannot delete or bind a successor', () => {
    const registry = new ActiveSubagentRunRegistry();
    const first = registry.registerExclusive(input())!;
    first.complete();
    const second = registry.registerExclusive(input('next'))!;
    first.complete();
    expect(() => first.assertCurrent()).toThrow('SUBAGENT_RUN_OWNER_STALE');
    expect(() => first.bindPromptMessageId('wrong')).toThrow('SUBAGENT_RUN_OWNER_STALE');
    expect(registry.getStatus('child')).toMatchObject({ turnId: 'next', promptMessageId: undefined });
    second.assertCurrent();
    second.complete();
  });

  it('binds a nonblank prompt only once and captures identity independently of caller mutations', async () => {
    const registry = new ActiveSubagentRunRegistry();
    const supplied = input();
    const originalController = supplied.controller;
    const owner = registry.registerExclusive(supplied)!;
    supplied.childSessionId = 'foreign'; supplied.turnId = 'foreign-turn'; supplied.controller = new AbortController();
    owner.assertCurrent();
    expect(() => owner.bindPromptMessageId(' ')).toThrow('SUBAGENT_RUN_PROMPT_INVALID');
    owner.bindPromptMessageId('prompt');
    owner.bindPromptMessageId('prompt');
    expect(() => owner.bindPromptMessageId('other')).toThrow('SUBAGENT_RUN_PROMPT_ALREADY_BOUND');
    expect(registry.getStatus('child')).toMatchObject({ turnId: 'turn', promptMessageId: 'prompt' });
    let settled = false;
    const stopping = registry.stopAndDrainSessions(['parent']).then(() => { settled = true; });
    expect(originalController.signal.aborted).toBe(true);
    expect(supplied.controller.signal.aborted).toBe(false);
    await Promise.resolve();
    expect(settled).toBe(false);
    owner.complete();
    await stopping;
    expect(settled).toBe(true);
    expect(registry.getStatus('child')).toBeNull();
  });

  it('settles its barrier on close failure but rejects drain without replacing the primary execution error', async () => {
    const registry = new ActiveSubagentRunRegistry();
    const supplied = input();
    const owner = registry.registerExclusive(supplied)!;
    const close = vi.fn(() => { throw new Error('private cleanup payload'); });
    registry.bindCancellationRecording('child', supplied.controller, () => ({ lookup: () => ({
      registerAdmission: async () => undefined, stop: vi.fn(), permitFor: () => null, close,
    }) }));
    const stopping = registry.stopAndDrainSessions(['parent']);
    const outcome = stopping.then(() => 'incorrect drain success', (error: unknown) => error);
    const primary = new Error('primary execution failure');
    expect(() => { try { throw primary; } finally { owner.complete(); } }).toThrow(primary);
    const failure = await outcome;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('SUBAGENT_RUN_CLEANUP_FAILED');
    expect(registry.getStatus('child')).toBeNull();
    owner.complete();
    expect(close).toHaveBeenCalledTimes(1);
    const successor = registry.registerExclusive(input('next'))!;
    owner.complete(); successor.assertCurrent(); successor.complete();
  });
});
