import { describe, expect, it, vi } from 'vitest';
import { completeSubagentRuntime } from './subagent-runtime-completion';

describe('observed subagent completion Stop fence', () => {
  it.each(['signal', 'loop'] as const)('rejects %s cancellation before copy, fallback save or producer drain', async mode => {
    const controller = new AbortController();
    if (mode === 'signal') controller.abort(new Error('stopped'));
    const copy = vi.fn(() => []);
    const save = vi.fn(async () => 'assistant');
    const drain = vi.fn(async () => undefined);
    const complete = vi.fn(async () => undefined);
    await expect(completeSubagentRuntime({
      request: { parentSessionId: 'parent', copyOutputs: true, vfsMode: 'isolated', hostRuntimeReceiptObserver: {
        admit: async () => undefined, commit: async () => undefined, drain, journalComplete: complete,
      } } as never,
      childSessionId: 'child', turnId: 'turn', promptMessageId: 'prompt', journalRunId: 'journal',
      loopResult: { lastMessageId: 'assistant', finalText: '', exhausted: false, aborted: mode === 'loop',
        iterationCount: 1, finalLimit: 1, emptyNoToolRetriesExhausted: false, maxIterationsReached: false },
      maxIterations: 1, streamedText: '', vfs: { copySessionFiles: copy } as never,
      persistTerminal: save, onJournalCommitted: complete, abortSignal: controller.signal,
    })).rejects.toThrow();
    expect(copy).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});
