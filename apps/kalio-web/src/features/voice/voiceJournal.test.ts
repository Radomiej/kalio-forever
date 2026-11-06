import { describe, expect, it, vi } from 'vitest';
import { createVoiceJournal, voiceDraftStore } from './voiceDraftStore';

describe('explicit journal discard', () => {
  it('does not publish a rejected append after discard, but still waits before deleting', async () => {
    let rejectWrite!: (error: Error) => void;
    const onState = vi.fn();
    const append = vi.spyOn(voiceDraftStore, 'append').mockImplementation(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
    const remove = vi.spyOn(voiceDraftStore, 'remove').mockResolvedValue(undefined);
    try {
      const journal = createVoiceJournal('failed-write', { sessionId: 's1' }, onState);
      journal.append(new Float32Array(4000), 16000);
      await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());
      onState.mockClear();
      const discarding = journal.discard();
      expect(remove).not.toHaveBeenCalled();
      rejectWrite(new Error('Quota exceeded'));
      await discarding;
      expect(remove).toHaveBeenCalledWith('failed-write');
      expect(onState).not.toHaveBeenCalled();
      expect(journal.unsaved).toBe(false);
    } finally { vi.restoreAllMocks(); }
  });
  it('drains a pending append before deletion and rejects late PCM and flush resurrection', async () => {
    let release!: () => void;
    const persisted = new Set<string>();
    const append = vi.spyOn(voiceDraftStore, 'append').mockImplementation(async (id) => {
      await new Promise<void>((resolve) => { release = resolve; });
      persisted.add(id);
      return { id, sessionId: 's1', sampleRate: 16000, sampleCount: 4000, chunkCount: 1, createdAt: 1 };
    });
    const remove = vi.spyOn(voiceDraftStore, 'remove').mockImplementation(async (id) => { persisted.delete(id); });
    try {
      const journal = createVoiceJournal('discard', { sessionId: 's1' }, vi.fn());
      journal.append(new Float32Array(4000), 16000);
      await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());
      const discarded = journal.discard();
      journal.append(new Float32Array(4000), 16000);
      const lateFlush = journal.flush();
      expect(remove).not.toHaveBeenCalled();
      release(); await discarded; await lateFlush;
      expect(append).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith('discard');
      expect(persisted.size).toBe(0); expect(journal.unsaved).toBe(false);
    } finally { vi.restoreAllMocks(); }
  });
});
