import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeSpeechWav, measureSpeechLevel, startSpeechCapture, type SpeechCapture } from './audioCapture';
import { isLocalSpeechPage, speechApi, speechScopeKey, type SpeechScope, type SpeechStatus } from './voiceApi';
import { createVoiceJournal, voiceDraftStore, type VoiceDraft } from './voiceDraftStore';

type Journal = ReturnType<typeof createVoiceJournal>;
interface Attempt {
  id: string; scope: SpeechScope; scopeKey: string; epoch: number; draft: string; controller: AbortController;
  capture?: SpeechCapture; uploaded: boolean; stopping: boolean; revision: number; journal?: Journal;
  recordingId?: string;
}

export function useVoiceInput(scope: SpeechScope | null, draft: string, onDraft: (text: string) => void) {
  const scopeKey = scope ? speechScopeKey(scope) : null;
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle');
  const [errorState, setErrorState] = useState<{ message: string; persistenceOwner?: Attempt } | null>(null);
  const error = errorState?.message ?? null;
  const setError = useCallback((message: string | null, persistenceOwner?: Attempt) => {
    setErrorState(message === null ? null : { message, persistenceOwner });
  }, []);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [savedDrafts, setSavedDrafts] = useState<VoiceDraft[]>([]);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error' | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [insertionVersion, setInsertionVersion] = useState(0);
  const [level, setLevel] = useState({ rms: 0, peak: 0, signal: false, received: false, bars: Array<number>(11).fill(0) });
  const current = useRef({ scope, scopeKey, draft, onDraft });
  const revision = useRef(0);
  const epoch = useRef(0);
  if (current.current.scopeKey !== scopeKey) epoch.current++;
  if (current.current.draft !== draft || current.current.scopeKey !== scopeKey) revision.current++;
  current.current = { scope, scopeKey, draft, onDraft };
  const attempt = useRef<Attempt | null>(null);
  const latestAttempt = useRef<Attempt | null>(null);
  const journals = useRef(new Map<string, Journal>());
  const mounted = useRef(true);
  const stopRef = useRef<() => Promise<void>>(async () => undefined);
  const lastLevelAt = useRef(0);
  const transcriptRecordingId = useRef<string | null>(null);
  const insertion = useRef<{ id: string; scope: SpeechScope; key: string; expected: string; text: string } | null>(null);

  const refreshDrafts = useCallback(async (owner: SpeechScope) => {
    const requestEpoch = epoch.current;
    const drafts = await voiceDraftStore.list(owner);
    if (mounted.current && current.current.scopeKey === speechScopeKey(owner) && epoch.current === requestEpoch) {
      setSavedDrafts(drafts); setStorageReady(true);
      // TODO: legacy fallback — pre-state delivery guards were not proof of insertion; recover their text conservatively.
      const pending = drafts.find((item) => item.cleanupOnly && item.deliveryState !== 'inserted'
        && item.deliveryText && item.expectedComposer !== current.current.draft);
      if (pending && !attempt.current && !insertion.current) {
        setTranscript(pending.deliveryText!); transcriptRecordingId.current = pending.id;
      }
    }
    return drafts;
  }, []);
  useEffect(() => {
    const pending = insertion.current;
    if (!pending) return;
    insertion.current = null;
    if (pending.key !== scopeKey || pending.expected !== draft) {
      void voiceDraftStore.setDelivery(pending.id, pending.text, false).then(() => refreshDrafts(pending.scope)).then(() => {
        if (mounted.current && current.current.scopeKey === pending.key) {
          setTranscript(pending.text); transcriptRecordingId.current = pending.id;
        }
      }).catch(() => {
        if (mounted.current && current.current.scopeKey === pending.key) setError('Text not inserted. Recording saved.');
      });
      return;
    }
    // Only the committed composer value acknowledges insertion, never the callback alone.
    void voiceDraftStore.setDelivery(pending.id, pending.text, true, pending.expected, 'inserted')
      .then(() => voiceDraftStore.remove(pending.id)).then(() => refreshDrafts(pending.scope)).catch(() => {
      if (mounted.current && current.current.scopeKey === pending.key) {
        setError('Text inserted. Audio deletion failed. Delete it below.');
        void refreshDrafts(pending.scope).catch(() => {
          if (mounted.current && current.current.scopeKey === pending.key) setError('Text inserted. Audio deletion failed. Delete it below.');
        });
      }
    });
  }, [draft, scopeKey, insertionVersion, refreshDrafts, setError]);
  const saveJournal = useCallback(async (journal: Journal) => {
    const saved = await journal.flush();
    if (saved) {
      journals.current.delete(journal.id); journal.clearMemory();
      await refreshDrafts(journal.scope);
    }
    return saved;
  }, [refreshDrafts]);

  const cancel = useCallback((discard = false) => {
    const active = attempt.current; attempt.current = null;
    const relevant = () => active && mounted.current && current.current.scopeKey === active.scopeKey
      && epoch.current === active.epoch && latestAttempt.current === active;
    // Detach the PCM producer synchronously before flushing and clearing journal buffers.
    active?.controller.abort();
    if (active?.capture) void active.capture.dispose().catch(() => {
      if (relevant()) setError('Could not close the microphone.');
    });
    if (discard && active) {
      const id = active.recordingId ?? active.id;
      const journal = active.journal;
      void (journal ? journal.discard() : voiceDraftStore.remove(id)).then(async () => {
        if (journal) journals.current.delete(journal.id);
        await refreshDrafts(active.scope);
        if (relevant()) {
          setSaveState(null);
          setErrorState((previous) => previous?.persistenceOwner === active ? null : previous);
        }
      }).catch(async () => {
        await refreshDrafts(active.scope).catch(() => {
          if (relevant()) setStorageReady(false);
        });
        if (relevant()) setError('Could not delete the recording. Try Delete again.');
      });
    }
    if (!discard && active?.journal) void saveJournal(active.journal).catch(() => {
      if (relevant()) setError('Save not confirmed. Keep this window open.', active ?? undefined);
    });
    if (active?.uploaded) void speechApi.cancel(active.id).catch(() => {
      if (relevant()) setError('Transcription cancellation not confirmed.');
    });
    if (mounted.current) { setPhase('idle'); setSeconds(0); setTranscript(null); }
  }, [saveJournal, refreshDrafts, setError]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!isLocalSpeechPage()) return;
    const controller = new AbortController();
    const refresh = () => {
      void speechApi.status(controller.signal).then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      }).catch(() => { if (!controller.signal.aborted) setStatus(null); });
    };
    refresh(); const timer = setInterval(refresh, 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    cancel(); setSavedDrafts([]); setSaveState(null); setError(null); setStorageReady(false);
    const owner = current.current.scope; const requestEpoch = epoch.current;
    if (owner) void refreshDrafts(owner).then((drafts) => {
      if (mounted.current && epoch.current === requestEpoch && drafts.some((item) => item.cleanupOnly
        && (item.deliveryState === 'inserted' || item.expectedComposer === current.current.draft))) {
        setError('Text inserted. Delete the remaining audio.');
      }
    }).catch(() => {
      if (mounted.current && epoch.current === requestEpoch) {
        setStorageReady(false); setError('Local storage unavailable. Check browser permissions.');
      }
    });
    return () => cancel();
  }, [scopeKey, cancel, refreshDrafts, setError]);
  useEffect(() => {
    const unload = () => cancel();
    const warn = (event: BeforeUnloadEvent) => {
      if (attempt.current?.capture || [...journals.current.values()].some((journal) => journal.unsaved)) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    window.addEventListener('pagehide', unload); window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('pagehide', unload); window.removeEventListener('beforeunload', warn); };
  }, [cancel]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      setSeconds((value) => Math.min(60, value + 1));
      if (performance.now() - lastLevelAt.current > 1000) setLevel({ rms: 0, peak: 0, signal: false, received: false, bars: Array<number>(11).fill(0) });
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const insertText = async (text: string, id: string, owner: SpeechScope, active?: Attempt) => {
    const before = current.current.draft; const beforeRevision = revision.current;
    const key = speechScopeKey(owner);
    const expected = [before, text].filter(Boolean).join('\n');
    // Persist a delivery guard before touching the composer: cleanup failures must never offer a normal Retry.
    await voiceDraftStore.setDelivery(id, text, true, expected);
    await refreshDrafts(owner);
    if (!mounted.current || (active && (attempt.current !== active || active.controller.signal.aborted))) {
      await voiceDraftStore.setDelivery(id, text, false);
      if (mounted.current) await refreshDrafts(owner);
      return false;
    }
    if (current.current.scopeKey !== key || current.current.draft !== before || revision.current !== beforeRevision) {
      await voiceDraftStore.setDelivery(id, text, false);
      if (current.current.scopeKey === key) { setTranscript(text); transcriptRecordingId.current = id; }
      return false;
    }
    insertion.current = { id, scope: owner, key, expected, text };
    try { current.current.onDraft(expected); setInsertionVersion((value) => value + 1); return true; }
    catch (error) {
      insertion.current = null; await voiceDraftStore.setDelivery(id, text, false);
      if (mounted.current) await refreshDrafts(owner);
      throw error;
    }
  };
  const deliver = async (active: Attempt, audio: Blob) => {
    if (attempt.current !== active || active.controller.signal.aborted || current.current.scopeKey !== active.scopeKey) return;
    active.uploaded = true;
    const text = await speechApi.transcribe(active.id, active.scope, audio, active.controller.signal);
    if (attempt.current !== active || current.current.scopeKey !== active.scopeKey) return;
    if (!text.trim()) { setError('No speech detected. Recording saved. Retry or delete.'); return; }
    if (current.current.draft === active.draft && revision.current === active.revision) {
      await insertText(text, active.recordingId ?? active.id, active.scope, active);
    } else { setTranscript(text); transcriptRecordingId.current = active.recordingId ?? active.id; }
  };

  const stop = async () => {
    const active = attempt.current;
    if (!active?.capture || active.stopping) return;
    active.stopping = true; setPhase('transcribing');
    try {
      const audio = await active.capture.stop(); active.capture = undefined;
      if (!active.journal || !await saveJournal(active.journal)) {
        if (attempt.current === active) setError('Save incomplete. Keep this window open and retry saving.', active);
        return;
      }
      await deliver(active, audio);
    } catch {
      if (attempt.current === active && !active.controller.signal.aborted) {
        setError('Transcription failed. Recording saved. Retry or delete.');
      }
    } finally {
      if (attempt.current === active) { attempt.current = null; setPhase('idle'); setSeconds(0); }
    }
  };
  stopRef.current = stop;

  const start = async () => {
    if (attempt.current || !scope || !scopeKey || !isLocalSpeechPage()) return;
    if (!storageReady || status?.status !== 'ready' || !status.installed) {
      setError('Set up the local model and draft storage before recording.'); return;
    }
    if ([...journals.current.values()].some((journal) => journal.unsaved)) {
      setError('Save or delete the previous recording first.'); return;
    }
    const active: Attempt = { id: crypto.randomUUID(), scope, scopeKey, epoch: epoch.current, draft, controller: new AbortController(),
      uploaded: false, stopping: false, revision: revision.current };
    attempt.current = active; latestAttempt.current = active;
    setError(null); setTranscript(null); setPhase('starting'); setSeconds(0);
    setLevel({ rms: 0, peak: 0, signal: false, received: false, bars: Array<number>(11).fill(0) });
    try {
      const journal = createVoiceJournal(active.id, scope, (state) => {
        const relevant = mounted.current && current.current.scopeKey === active.scopeKey && epoch.current === active.epoch
          && (!attempt.current || attempt.current === active);
        if (relevant) setSaveState(state);
        if (state === 'error') {
          if (relevant) setError('Save failed. Keep this window open and retry saving.', active);
          if (attempt.current === active) void stopRef.current();
        }
      });
      active.journal = journal; journals.current.set(journal.id, journal);
      const capture = await startSpeechCapture(active.controller.signal, () => { void stopRef.current(); }, (pcm, rate) => {
        if (attempt.current !== active || active.controller.signal.aborted) return;
        journal.append(pcm, rate);
        if (performance.now() - lastLevelAt.current >= 100) {
          lastLevelAt.current = performance.now();
          if (mounted.current && attempt.current === active) {
            const measured = measureSpeechLevel(pcm);
            const amplitude = Math.min(1, Math.max(measured.rms * 5, measured.peak));
            setLevel((previous) => ({ ...measured, received: true, bars: [...previous.bars.slice(1), amplitude] }));
          }
        }
      }, (message) => {
        if (attempt.current === active) { cancel(); setError(`${message} Recording saved.`); }
      });
      if (attempt.current !== active) { await capture.dispose(); return; }
      active.capture = capture; setPhase('recording');
    } catch (cause) {
      if (attempt.current === active) {
        cancel(); setError(cause instanceof Error ? cause.message : 'Microphone unavailable.');
      }
    }
  };

  const retry = async (recording: VoiceDraft) => {
    if (recording.cleanupOnly) { setError('Text already inserted. Delete the remaining audio.'); return; }
    if (attempt.current || speechScopeKey(recording) !== current.current.scopeKey || !isLocalSpeechPage()) return;
    if (typeof recording.sessionId !== 'string' && typeof recording.draftId !== 'string') {
      setError('Invalid draft. Audio kept.'); return;
    }
    const owner: SpeechScope = typeof recording.sessionId === 'string' ? { sessionId: recording.sessionId } : { draftId: recording.draftId as string };
    const active: Attempt = { id: crypto.randomUUID(), scope: owner, scopeKey: speechScopeKey(owner), epoch: epoch.current, draft: current.current.draft,
      revision: revision.current, controller: new AbortController(), uploaded: false, stopping: true, recordingId: recording.id };
    attempt.current = active; latestAttempt.current = active; setPhase('transcribing'); setError(null); setTranscript(null);
    try {
      const confirmed = await speechApi.status(active.controller.signal);
      if (confirmed.status !== 'ready' || !confirmed.installed) throw new Error('Model not ready.');
      const pcm = await voiceDraftStore.read(recording);
      try { await deliver(active, encodeSpeechWav(pcm, recording.sampleRate)); }
      finally { pcm.forEach((chunk) => chunk.fill(0)); }
    } catch {
      if (attempt.current === active) setError('Transcription failed. Recording saved. Retry or delete.');
    } finally { if (attempt.current === active) { attempt.current = null; setPhase('idle'); } }
  };
  const remove = async (id: string) => {
    if (attempt.current) return;
    const requestEpoch = epoch.current;
    const requestScope = current.current.scopeKey;
    try {
      // Drain pending writes before Delete so an in-flight append cannot resurrect the recording.
      const journal = journals.current.get(id);
      if (journal) await journal.flush();
      await voiceDraftStore.remove(id);
      if (mounted.current && epoch.current === requestEpoch && current.current.scopeKey === requestScope
        && transcriptRecordingId.current === id) {
        transcriptRecordingId.current = null; setTranscript(null);
      }
      journals.current.get(id)?.clearMemory(); journals.current.delete(id);
      if (epoch.current === requestEpoch && mounted.current) { setSaveState(null); setError(null); }
      if (scope) await refreshDrafts(scope);
    } catch { if (epoch.current === requestEpoch && mounted.current) setError('Could not delete the recording. Try Delete again.'); }
  };
  const recover = (recording: VoiceDraft) => {
    if (!mounted.current || attempt.current || phase !== 'idle' || !current.current.scopeKey
      || speechScopeKey(recording) !== current.current.scopeKey || !recording.deliveryText?.trim()) return;
    if (recording.deliveryState === 'inserted' || recording.expectedComposer === current.current.draft) {
      if (transcriptRecordingId.current === recording.id) {
        transcriptRecordingId.current = null; setTranscript(null);
      }
      setError('Text already inserted. Delete the remaining audio.'); return;
    }
    transcriptRecordingId.current = recording.id; setTranscript(recording.deliveryText);
  };
  const retrySave = async () => {
    const requestEpoch = epoch.current;
    try {
      for (const journal of journals.current.values()) if (speechScopeKey(journal.scope) === scopeKey) {
        if (!await saveJournal(journal)) return;
      }
      if (epoch.current === requestEpoch && mounted.current) setError(null);
    } catch { if (epoch.current === requestEpoch && mounted.current) setError('Save failed. Keep this window open and retry saving.'); }
  };

  return {
    status, storageReady, phase, error, transcript, seconds, start, stop, cancel: () => cancel(true), savedDrafts, saveState, level, retry, recover, remove, retrySave,
    unsavedIds: [...journals.current.values()].filter((journal) => speechScopeKey(journal.scope) === scopeKey && journal.unsaved).map((journal) => journal.id),
    insert: async () => {
      if (!transcript || !transcriptRecordingId.current || !scope) return;
      try { if (await insertText(transcript, transcriptRecordingId.current, scope)) setTranscript(null); }
      catch { setError('Text not inserted. Recording saved.'); }
    },
    discard: () => setTranscript(null),
    ready: isLocalSpeechPage() && storageReady && status?.status === 'ready' && status.installed && Boolean(scope),
  };
}
