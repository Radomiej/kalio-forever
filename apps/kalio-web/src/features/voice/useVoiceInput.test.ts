import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceInput as useScopedVoiceInput } from './useVoiceInput';
import type { SpeechScope } from './voiceApi';
import type { VoiceDraft } from './voiceDraftStore';
import { useState } from 'react';
function useVoiceInput(sessionId: string, draft: string, onDraft: (text: string) => void) {
  return useScopedVoiceInput({ sessionId }, draft, onDraft);
}

const mock = vi.hoisted(() => ({
  status: vi.fn(), transcribe: vi.fn(), cancel: vi.fn(), capture: vi.fn(),
  stop: vi.fn(), dispose: vi.fn(), local: true,
  list: vi.fn(), read: vi.fn(), remove: vi.fn(), setDelivery: vi.fn(), append: vi.fn(), journalFlush: vi.fn(), failSave: false,
  journalStates: [] as Array<(state: 'saving' | 'saved' | 'error') => void>,
  records: new Map<string, VoiceDraft>(),
  pcm: new Map<string, Float32Array[]>(),
}));
vi.mock('./voiceApi', async (importOriginal) => ({ ...await importOriginal<typeof import('./voiceApi')>(), isLocalSpeechPage: () => mock.local,
  speechApi: { status: mock.status, transcribe: mock.transcribe, cancel: mock.cancel } }));
vi.mock('./audioCapture', async (importOriginal) => ({
  ...await importOriginal<typeof import('./audioCapture')>(), startSpeechCapture: mock.capture,
}));
vi.mock('./voiceDraftStore', () => ({
  voiceDraftStore: { list: mock.list, read: mock.read, remove: mock.remove, setDelivery: mock.setDelivery },
  createVoiceJournal: (id: string, scope: SpeechScope, onState: (state: 'saving' | 'saved' | 'error') => void) => {
    mock.journalStates.push(onState);
    let pending: Float32Array[] = []; let rate = 16000;
    return { id, scope, get unsaved() { return pending.length > 0; },
      append: (chunk: Float32Array, sampleRate: number) => { pending.push(chunk.slice()); rate = sampleRate; onState('saving'); },
      flush: async () => {
        mock.journalFlush();
        if (mock.failSave) { onState('error'); return false; }
        const chunks = [...(mock.pcm.get(id) ?? []), ...pending];
        mock.pcm.set(id, chunks); pending = [];
        const previous = mock.records.get(id);
        mock.records.set(id, { id, ...scope, cleanupOnly: previous?.cleanupOnly, deliveryText: previous?.deliveryText,
          deliveryState: previous?.deliveryState, expectedComposer: previous?.expectedComposer,
          sampleRate: rate, sampleCount: chunks.reduce((sum, chunk) => sum + chunk.length, 0), chunkCount: chunks.length, createdAt: 1 });
        onState('saved'); return true;
      }, discard: async () => { pending = []; await mock.remove(id); }, clearMemory: vi.fn(),
    };
  },
}));
const ready = { status: 'ready', installed: true };
function pendingRecord(id: string, sessionId = 's1'): VoiceDraft {
  return { id, sessionId, sampleRate: 16000, sampleCount: 1600, chunkCount: 1, createdAt: 1,
    cleanupOnly: true, deliveryState: 'pending', deliveryText: `Text ${id}`, expectedComposer: `Text ${id}` };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

beforeEach(() => {
  vi.clearAllMocks(); mock.local = true;
  mock.failSave = false; mock.journalStates = []; mock.records.clear(); mock.pcm.clear();
  mock.list.mockImplementation(async (scope: SpeechScope) => [...mock.records.values()].filter((record) => record.sessionId === scope.sessionId && record.draftId === scope.draftId));
  mock.read.mockImplementation(async (record: { id: string }) => (mock.pcm.get(record.id) ?? []).map((chunk) => chunk.slice()));
  mock.remove.mockImplementation(async (id: string) => { mock.records.delete(id); mock.pcm.delete(id); });
  mock.setDelivery.mockImplementation(async (id: string, text: string, cleanupOnly = true, expectedComposer?: string, deliveryState: 'pending' | 'inserted' = 'pending') => {
    const record = mock.records.get(id);
    if (!record) throw new Error('Missing recording');
    mock.records.set(id, { ...record, cleanupOnly, deliveryText: text, expectedComposer, deliveryState: cleanupOnly ? deliveryState : undefined });
  });
  mock.status.mockResolvedValue(ready); mock.transcribe.mockResolvedValue('Recognized text');
  mock.cancel.mockResolvedValue({ cancelled: true });
  mock.stop.mockResolvedValue(new Blob(['wav'])); mock.dispose.mockResolvedValue(undefined);
  mock.capture.mockImplementation(async (_signal, _onLimit, onPcm) => {
    onPcm(new Float32Array(1600).fill(0.1), 16000);
    return { stop: mock.stop, dispose: mock.dispose };
  });
});

describe('voice input lifecycle', () => {
  it.each(['none', 'microphone', 'delete', 'new-attempt', 'unrelated'])('clears only its obsolete persistence warning after discard, later error=%s', async (later) => {
    let finishStop!: (audio: Blob) => void;
    mock.stop.mockImplementationOnce(() => new Promise<Blob>((resolve) => { finishStop = resolve; }));
    let finishDelete!: () => void;
    let rejectDelete!: (error: Error) => void;
    mock.remove.mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finishDelete = resolve; rejectDelete = reject; }));
    if (later === 'microphone') mock.dispose.mockRejectedValueOnce(new Error('Close failed'));
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.start());
    act(() => mock.journalStates[0]('error'));
    expect(result.current.error).toBe('Save failed. Keep this window open and retry saving.');
    act(() => result.current.cancel());
    if (later === 'unrelated') await act(() => result.current.retry(pendingRecord('other')));
    if (later === 'new-attempt') {
      await act(() => result.current.start());
      act(() => mock.journalStates[1]('error'));
    }
    await act(async () => {
      if (later === 'delete') rejectDelete(new Error('Delete failed')); else finishDelete();
      await Promise.resolve();
    });
    if (later === 'none') await waitFor(() => expect(result.current.error).toBeNull());
    if (later === 'microphone') expect(result.current.error).toBe('Could not close the microphone.');
    if (later === 'delete') await waitFor(() => expect(result.current.error).toBe('Could not delete the recording. Try Delete again.'));
    if (later === 'unrelated') expect(result.current.error).toBe('Text already inserted. Delete the remaining audio.');
    if (later === 'new-attempt') expect(result.current.error).toBe('Save failed. Keep this window open and retry saving.');
    // Settle the old stop after the discard; it must never deliver the aborted attempt.
    await act(async () => { finishStop(new Blob(['wav'])); await Promise.resolve(); });
    expect(mock.transcribe.mock.calls.some(([id]) => id === mock.remove.mock.calls[0][0])).toBe(false);
  });
  it('builds bar history from actual PCM amplitude and resets it for a new recording', async () => {
    let receive!: (pcm: Float32Array, rate: number) => void;
    let now = 1000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    mock.capture.mockImplementation(async (_signal, _limit, onPcm) => {
      receive = onPcm;
      return { stop: mock.stop, dispose: mock.dispose };
    });
    try {
      const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
      await waitFor(() => expect(result.current.ready).toBe(true));
      await act(() => result.current.start());
      act(() => receive(new Float32Array(128).fill(0.1), 16000));
      expect(result.current.level.bars.at(-1)).toBeCloseTo(0.5);
      now += 100;
      act(() => receive(new Float32Array(128), 16000));
      expect(result.current.level.bars.at(-2)).toBeCloseTo(0.5);
      expect(result.current.level.bars.at(-1)).toBe(0);
      act(() => result.current.cancel());
      await waitFor(() => expect(mock.remove).toHaveBeenCalled());
      await act(() => result.current.start());
      expect(result.current.level.bars).toEqual(Array(11).fill(0));
    } finally { clock.mockRestore(); }
  });
  it('recover restores a dismissed pending result without network or insertion', async () => {
    const record = pendingRecord('a'); mock.records.set(record.id, record);
    const onDraft = vi.fn(); const { result } = renderHook(() => useVoiceInput('s1', '', onDraft));
    await waitFor(() => expect(result.current.transcript).toBe('Text a'));
    act(() => result.current.discard()); mock.status.mockClear();
    act(() => result.current.recover(record));
    expect(result.current.transcript).toBe('Text a'); expect(onDraft).not.toHaveBeenCalled();
    expect(mock.status).not.toHaveBeenCalled(); expect(mock.transcribe).not.toHaveBeenCalled(); expect(mock.read).not.toHaveBeenCalled();
  });
  it('remove clears the transcript only when the successfully deleted id matches', async () => {
    const a = pendingRecord('a'); const b = pendingRecord('b');
    mock.records.set('a', a); mock.records.set('b', b);
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.transcript).toBe('Text a'));
    await act(() => result.current.remove('b'));
    expect(result.current.transcript).toBe('Text a');
    await act(() => result.current.remove('a'));
    expect(result.current.transcript).toBeNull();
    await act(() => result.current.insert()); expect(mock.setDelivery).not.toHaveBeenCalled();
  });
  it('failed remove preserves the matching pending transcript', async () => {
    mock.records.set('a', pendingRecord('a')); mock.remove.mockRejectedValueOnce(new Error('Delete failed'));
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.transcript).toBe('Text a'));
    await act(() => result.current.remove('a'));
    expect(result.current.transcript).toBe('Text a');
  });
  it('late remove does not clear a transcript after a scope roundtrip changed epoch', async () => {
    mock.records.set('a', pendingRecord('a'));
    let finish!: () => void;
    mock.remove.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { finish = resolve; }); mock.records.delete('a'); });
    const { result, rerender } = renderHook(({ sid }) => useVoiceInput(sid, '', vi.fn()), { initialProps: { sid: 's1' } });
    await waitFor(() => expect(result.current.transcript).toBe('Text a'));
    let removing!: Promise<void>;
    act(() => { removing = result.current.remove('a'); });
    rerender({ sid: 's2' }); rerender({ sid: 's1' });
    await waitFor(() => expect(result.current.transcript).toBe('Text a'));
    await act(async () => { finish(); await removing; });
    expect(result.current.transcript).toBe('Text a');
  });
  it('recover rejects foreign scope and busy capture without replacing pending text', async () => {
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.recover(pendingRecord('foreign', 's2')));
    expect(result.current.transcript).toBeNull();
    await act(() => result.current.start());
    act(() => result.current.recover(pendingRecord('busy')));
    expect(result.current.transcript).toBeNull(); expect(mock.transcribe).not.toHaveBeenCalled();
  });
  it.each(['inserted', 'matching'])('recover fails closed for %s delivery', async (kind) => {
    const record = pendingRecord('a');
    if (kind === 'inserted') record.deliveryState = 'inserted';
    mock.records.set('a', record);
    const onDraft = vi.fn();
    const { result } = renderHook(() => useVoiceInput('s1', kind === 'matching' ? 'Text a' : '', onDraft));
    await waitFor(() => expect(result.current.savedDrafts).toHaveLength(1));
    act(() => result.current.recover(record));
    expect(result.current.transcript).toBeNull(); expect(onDraft).not.toHaveBeenCalled(); expect(mock.transcribe).not.toHaveBeenCalled();
  });
  it('recover closes the matching stale Insert after the composer already contains its expected text', async () => {
    const record = pendingRecord('a'); mock.records.set('a', record);
    const { result, rerender } = renderHook(({ draft }) => useVoiceInput('s1', draft, vi.fn()), { initialProps: { draft: '' } });
    await waitFor(() => expect(result.current.transcript).toBe('Text a'));
    rerender({ draft: 'Text a' });
    act(() => result.current.recover(record));
    expect(result.current.transcript).toBeNull();
    await act(() => result.current.insert()); expect(mock.setDelivery).not.toHaveBeenCalled();
  });
  it('recovers a precommit delivery guard after unmount and inserts explicitly without retranscribing', async () => {
    const first = renderHook(() => useVoiceInput('s1', '', () => first.unmount()));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(() => first.result.current.start()); await act(() => first.result.current.stop());
    expect(mock.remove).not.toHaveBeenCalled(); expect(mock.records.size).toBe(1);
    const reopened = renderHook(() => {
      const [draft, setDraft] = useState('');
      return { draft, voice: useVoiceInput('s1', draft, setDraft) };
    });
    await waitFor(() => expect(reopened.result.current.voice.transcript).toBe('Recognized text'));
    expect(reopened.result.current.draft).toBe(''); expect(mock.remove).not.toHaveBeenCalled();
    await act(() => reopened.result.current.voice.insert());
    await waitFor(() => expect(mock.remove).toHaveBeenCalledOnce());
    expect(reopened.result.current.draft).toBe('Recognized text'); expect(mock.transcribe).toHaveBeenCalledOnce();
  });
  it('keeps a committed cleanup failure delete-only after a fresh mount', async () => {
    mock.remove.mockRejectedValue(new Error('Delete failed'));
    const first = renderHook(() => {
      const [draft, setDraft] = useState('');
      return useVoiceInput('s1', draft, setDraft);
    });
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(() => first.result.current.start()); await act(() => first.result.current.stop());
    await waitFor(() => expect(first.result.current.error).toContain('Delete'));
    expect([...mock.records.values()][0].deliveryState).toBe('inserted');
    first.unmount();
    const onDraft = vi.fn();
    const reopened = renderHook(() => useVoiceInput('s1', '', onDraft));
    await waitFor(() => expect(reopened.result.current.savedDrafts).toHaveLength(1));
    expect(reopened.result.current.transcript).toBeNull();
    await act(() => reopened.result.current.retry(reopened.result.current.savedDrafts[0]));
    expect(onDraft).not.toHaveBeenCalled(); expect(mock.transcribe).toHaveBeenCalledOnce();
  });
  it('dictates into an unsent launch draft and recovers its recording after remount', async () => {
    const onDraft = vi.fn();
    const first = renderHook(() => useScopedVoiceInput({ draftId: 'launch-id' }, '', onDraft));
    await waitFor(() => expect(first.result.current.ready).toBe(true)); await act(() => first.result.current.start());
    await act(() => first.result.current.stop());
    expect(mock.transcribe).toHaveBeenCalledWith(expect.any(String), { draftId: 'launch-id' }, expect.any(Blob), expect.any(AbortSignal));
    expect(onDraft).toHaveBeenCalledWith('Recognized text');
    first.unmount();
    const reopened = renderHook(() => useScopedVoiceInput({ draftId: 'launch-id' }, '', onDraft));
    await waitFor(() => expect(reopened.result.current.savedDrafts).toHaveLength(1));
    expect(reopened.result.current.savedDrafts[0]).toHaveProperty('draftId', 'launch-id');
    expect(reopened.result.current.savedDrafts[0]).not.toHaveProperty('sessionId');
  });
  it('does not open microphone when local storage cannot be checked', async () => {
    mock.list.mockRejectedValue(new Error('Storage unavailable'));
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.error).not.toBeNull()); await act(() => result.current.start());
    expect(mock.capture).not.toHaveBeenCalled(); expect(result.current.ready).toBe(false);
  });
  it('discards capture without saving and ignores late PCM', async () => {
    let latePcm!: (pcm: Float32Array, rate: number) => void;
    mock.capture.mockImplementation(async (_signal, _limit, onPcm) => {
      latePcm = onPcm; onPcm(new Float32Array(1600), 16000);
      return { stop: mock.stop, dispose: mock.dispose };
    });
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    act(() => result.current.cancel());
    act(() => latePcm(new Float32Array(1600), 16000));
    await waitFor(() => expect(mock.remove).toHaveBeenCalled());
    expect(mock.dispose).toHaveBeenCalled(); expect(mock.records.size).toBe(0);
    expect(mock.journalFlush).not.toHaveBeenCalled();
  });
  it('does not report an old session cancellation failure in the new session', async () => {
    let rejectCancel!: (error: Error) => void;
    mock.cancel.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCancel = reject; }));
    let finish!: (text: string) => void;
    mock.transcribe.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ sid }) => useVoiceInput(sid, '', vi.fn()), { initialProps: { sid: 's1' } });
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    let pending!: Promise<void>;
    act(() => { pending = result.current.stop(); });
    await waitFor(() => expect(mock.transcribe).toHaveBeenCalled());
    rerender({ sid: 's2' });
    await act(async () => { rejectCancel(new Error('Old cancellation failed')); finish('Old text'); await pending; });
    expect(result.current.error).toBeNull(); expect(result.current.transcript).toBeNull();
  });
  it('never requests microphone on mount; inserts into draft without a send callback', async () => {
    const onDraft = vi.fn();
    const { result } = renderHook(() => useVoiceInput('s1', 'Existing', onDraft));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(mock.capture).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    expect(result.current.phase).toBe('recording');
    await act(() => result.current.stop());
    expect(onDraft).toHaveBeenCalledExactlyOnceWith('Existing\nRecognized text');
    expect(mock.transcribe).toHaveBeenCalledWith(expect.any(String), { sessionId: 's1' }, expect.any(Blob), expect.any(AbortSignal));
  });
  it('invokes capture in the click stack before any new asynchronous storage or status work', async () => {
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    mock.list.mockClear(); mock.status.mockClear();
    let started!: Promise<void>;
    act(() => { started = result.current.start(); });
    expect(mock.capture).toHaveBeenCalledOnce();
    expect(mock.list).not.toHaveBeenCalled(); expect(mock.status).not.toHaveBeenCalled();
    await act(async () => { await started; });
  });
  it('blocks capture when cached backend readiness is missing', async () => {
    mock.status.mockResolvedValue({ status: 'missing', installed: false });
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.status?.status).toBe('missing'));
    await act(() => result.current.start());
    expect(mock.capture).not.toHaveBeenCalled(); expect(result.current.error).toContain('model');
  });
  it('discards recording without uploading and disposes capture', async () => {
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    act(() => result.current.cancel());
    expect(mock.dispose).toHaveBeenCalled(); expect(mock.transcribe).not.toHaveBeenCalled();
    expect(mock.cancel).not.toHaveBeenCalled(); expect(result.current.phase).toBe('idle');
    await waitFor(() => expect(mock.remove).toHaveBeenCalled());
    expect(mock.records.size).toBe(0);
  });
  it('retains a failed transcription across remount and retries without recording again', async () => {
    mock.transcribe.mockRejectedValueOnce(new Error('Network failed'));
    const onDraft = vi.fn();
    const first = renderHook(() => useVoiceInput('s1', '', onDraft));
    await waitFor(() => expect(first.result.current.ready).toBe(true)); await act(() => first.result.current.start());
    await act(() => first.result.current.stop());
    expect(first.result.current.error).toContain('Recording saved');
    expect(first.result.current.savedDrafts).toHaveLength(1);
    first.unmount();
    const reopened = renderHook(() => useVoiceInput('s1', 'New draft', onDraft));
    await waitFor(() => expect(reopened.result.current.savedDrafts).toHaveLength(1));
    await act(() => reopened.result.current.retry(reopened.result.current.savedDrafts[0]));
    expect(mock.capture).toHaveBeenCalledOnce();
    expect(onDraft).toHaveBeenCalledWith('New draft\nRecognized text');
    expect(reopened.result.current.savedDrafts).toHaveLength(1);
    expect(mock.remove).not.toHaveBeenCalled();
  });
  it('reports quota failure without uploading, then allows Retry save', async () => {
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    mock.failSave = true;
    await act(() => result.current.stop());
    expect(result.current.saveState).toBe('error');
    expect(result.current.unsavedIds).toHaveLength(1);
    expect(mock.transcribe).not.toHaveBeenCalled();
    mock.failSave = false;
    await act(() => result.current.retrySave());
    expect(result.current.saveState).toBe('saved'); expect(result.current.savedDrafts).toHaveLength(1);
  });
  it('drains a retained journal before explicit Delete and never removes on failed transcription', async () => {
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    mock.failSave = true;
    await act(() => result.current.stop());
    const id = result.current.unsavedIds[0];
    expect(mock.remove).not.toHaveBeenCalled();
    mock.journalFlush.mockClear();
    await act(() => result.current.remove(id));
    expect(mock.journalFlush).toHaveBeenCalled(); expect(mock.remove).toHaveBeenCalledWith(id);
    expect(mock.journalFlush.mock.invocationCallOrder[0]).toBeLessThan(mock.remove.mock.invocationCallOrder[0]);
    expect(result.current.unsavedIds).toHaveLength(0);
  });
  it('keeps a concurrent draft edit and requires explicit transcript insertion', async () => {
    const onDraft = vi.fn();
    const { result, rerender } = renderHook(({ draft }) => useVoiceInput('s1', draft, onDraft), { initialProps: { draft: 'Before' } });
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    rerender({ draft: 'Newer edit' });
    await act(() => result.current.stop());
    expect(onDraft).not.toHaveBeenCalled(); expect(result.current.transcript).toBe('Recognized text');
    await act(() => result.current.insert());
    expect(onDraft).toHaveBeenCalledWith('Newer edit\nRecognized text');
  });
  it('deletes raw audio only after a committed composer insertion', async () => {
    const { result } = renderHook(() => {
      const [draft, setDraft] = useState('Typed');
      return { voice: useScopedVoiceInput({ draftId: 'launch' }, draft, setDraft), draft };
    });
    await waitFor(() => expect(result.current.voice.ready).toBe(true));
    await act(() => result.current.voice.start());
    expect(mock.remove).not.toHaveBeenCalled();
    await act(() => result.current.voice.stop());
    await waitFor(() => expect(result.current.voice.savedDrafts).toHaveLength(0));
    expect(result.current.draft).toBe('Typed\nRecognized text');
    expect(mock.remove).toHaveBeenCalledOnce(); expect(mock.records.size).toBe(0);
  });
  it('keeps cleanup-only state after delete failure and never appends a second transcript', async () => {
    mock.remove.mockRejectedValue(new Error('Delete failed'));
    const onDraft = vi.fn();
    const { result } = renderHook(() => {
      const [draft, setDraft] = useState('');
      return { voice: useVoiceInput('s1', draft, (text) => { onDraft(text); setDraft(text); }), draft };
    });
    await waitFor(() => expect(result.current.voice.ready).toBe(true));
    await act(() => result.current.voice.start()); await act(() => result.current.voice.stop());
    await waitFor(() => expect(result.current.voice.error).toContain('Delete'));
    const recording = result.current.voice.savedDrafts[0];
    expect(recording.cleanupOnly).toBe(true);
    await act(() => result.current.voice.retry(recording));
    expect(mock.transcribe).toHaveBeenCalledOnce(); expect(onDraft).toHaveBeenCalledOnce();
    mock.remove.mockImplementation(async (id: string) => { mock.records.delete(id); mock.pcm.delete(id); });
    await act(() => result.current.voice.remove(recording.id));
    expect(onDraft).toHaveBeenCalledOnce(); expect(mock.records.size).toBe(0);
  });
  it('retains raw audio until explicit Insert acknowledges a concurrent edit', async () => {
    const { result } = renderHook(() => {
      const [draft, setDraft] = useState('Before');
      return { voice: useVoiceInput('s1', draft, setDraft), draft, setDraft };
    });
    await waitFor(() => expect(result.current.voice.ready).toBe(true));
    await act(() => result.current.voice.start()); act(() => result.current.setDraft('Newer'));
    await act(() => result.current.voice.stop());
    expect(mock.remove).not.toHaveBeenCalled(); expect(result.current.voice.transcript).toBe('Recognized text');
    await act(() => result.current.voice.insert());
    await waitFor(() => expect(mock.remove).toHaveBeenCalledOnce());
    expect(result.current.draft).toBe('Newer\nRecognized text');
  });
  it('preserves an empty transcription without delivery or deletion', async () => {
    mock.transcribe.mockResolvedValue('   ');
    const onDraft = vi.fn();
    const { result } = renderHook(() => useVoiceInput('s1', '', onDraft));
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    await act(() => result.current.stop());
    expect(result.current.error).toContain('No speech detected');
    expect(onDraft).not.toHaveBeenCalled(); expect(mock.setDelivery).not.toHaveBeenCalled(); expect(mock.remove).not.toHaveBeenCalled();
    expect(result.current.savedDrafts).toHaveLength(1);
  });
  it('does not delete audio when the composer rejects insertion', async () => {
    const { result } = renderHook(() => useVoiceInput('s1', '', () => { throw new Error('Composer rejected'); }));
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    await act(() => result.current.stop());
    expect(mock.remove).not.toHaveBeenCalled(); expect(mock.records.size).toBe(1);
    expect([...mock.records.values()][0].cleanupOnly).toBe(false);
  });
  it('requires actual draft acknowledgment even if the insertion callback returns normally', async () => {
    const onDraft = vi.fn();
    const { result } = renderHook(() => useVoiceInput('s1', '', onDraft));
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    await act(() => result.current.stop());
    await waitFor(() => expect(result.current.transcript).toBe('Recognized text'));
    expect(onDraft).toHaveBeenCalledOnce(); expect(mock.remove).not.toHaveBeenCalled();
    expect([...mock.records.values()][0].cleanupOnly).toBe(false);
  });
  it('leaves pending permission after the bounded timeout and stops a late granted stream', async () => {
    const actual = await vi.importActual<typeof import('./audioCapture')>('./audioCapture');
    let grant!: (stream: MediaStream) => void;
    const trackStop = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve; })) } });
    mock.capture.mockImplementationOnce(actual.startSpeechCapture);
    const { result } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.useFakeTimers();
    let pending!: Promise<void>;
    act(() => { pending = result.current.start(); });
    expect(result.current.phase).toBe('starting');
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); await pending; });
    expect(result.current.phase).toBe('idle'); expect(result.current.error).toMatch(/permissions|Chrome/);
    grant({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream);
    await act(async () => { await Promise.resolve(); });
    expect(trackStop).toHaveBeenCalledOnce(); expect(mock.transcribe).not.toHaveBeenCalled(); expect(mock.remove).not.toHaveBeenCalled();
  });
  it('discards without insertion when cancelled during the delivery guard write', async () => {
    const normal = mock.setDelivery.getMockImplementation()!;
    let finish!: () => void;
    mock.setDelivery.mockImplementationOnce(async (...args) => { await new Promise<void>((resolve) => { finish = resolve; }); return normal(...args); });
    const onDraft = vi.fn(); const { result } = renderHook(() => useVoiceInput('s1', '', onDraft));
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    let pending!: Promise<void>;
    act(() => { pending = result.current.stop(); });
    await waitFor(() => expect(mock.setDelivery).toHaveBeenCalled());
    act(() => result.current.cancel());
    await act(async () => { finish(); await pending; });
    expect(onDraft).not.toHaveBeenCalled(); expect(mock.remove).toHaveBeenCalled(); expect(mock.records.size).toBe(0);
  });
  it('rejects a late result after changing sessions and cancels backend work', async () => {
    let finish!: (text: string) => void;
    mock.transcribe.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const onDraft = vi.fn();
    const { result, rerender } = renderHook(({ session }) => useVoiceInput(session, '', onDraft), { initialProps: { session: 's1' } });
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start());
    let pending!: Promise<void>;
    act(() => { pending = result.current.stop(); });
    await waitFor(() => expect(mock.transcribe).toHaveBeenCalled());
    rerender({ session: 's2' });
    await act(async () => { finish('Late result'); await pending; });
    expect(onDraft).not.toHaveBeenCalled(); expect(result.current.transcript).toBeNull();
    expect(mock.cancel).toHaveBeenCalledOnce();
  });
  it('disposes on unmount and never enables remote capture', async () => {
    const { result, unmount } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true)); await act(() => result.current.start()); unmount();
    expect(mock.dispose).toHaveBeenCalled();
    mock.local = false;
    const remote = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    expect(remote.result.current.ready).toBe(false);
    const before = mock.capture.mock.calls.length;
    await act(() => remote.result.current.start());
    expect(mock.capture).toHaveBeenCalledTimes(before);
  });
  it('disposes a late capture after unmount without uploading or deleting audio', async () => {
    let grant!: (capture: { stop: typeof mock.stop; dispose: typeof mock.dispose }) => void;
    mock.capture.mockImplementationOnce(() => new Promise((resolve) => { grant = resolve; }));
    const { result, unmount } = renderHook(() => useVoiceInput('s1', '', vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let pending!: Promise<void>;
    act(() => { pending = result.current.start(); });
    unmount(); grant({ stop: mock.stop, dispose: mock.dispose });
    await act(async () => { await pending; });
    expect(mock.dispose).toHaveBeenCalled(); expect(mock.transcribe).not.toHaveBeenCalled(); expect(mock.remove).not.toHaveBeenCalled();
  });
});
