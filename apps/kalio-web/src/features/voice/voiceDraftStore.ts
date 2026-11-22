import type { SpeechScope } from './voiceApi';

const speechScopeKey = (scope: SpeechScope) => scope.sessionId ? `session:${scope.sessionId}` : `draft:${scope.draftId}`;

export type VoiceDraft = SpeechScope & {
  id: string;
  sampleRate: number;
  sampleCount: number;
  chunkCount: number;
  createdAt: number;
  cleanupOnly?: boolean;
  deliveryText?: string;
  deliveryState?: 'pending' | 'inserted';
  expectedComposer?: string;
}

interface StoredChunk { key: string; draftId: string; index: number; pcm: Float32Array }

export function createVoiceDraftStore(name = 'kalio-local-voice-drafts') {
  async function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('drafts', { keyPath: 'id' });
        const chunks = request.result.createObjectStore('chunks', { keyPath: 'key' });
        chunks.createIndex('draftId', 'draftId');
      };
      request.onerror = () => reject(request.error ?? new Error('Voice draft storage unavailable.'));
      request.onblocked = () => reject(new Error('Close other Kalio tabs to open voice draft storage.'));
      request.onsuccess = () => resolve(request.result);
    });
  }
  async function transaction<T>(stores: string[], mode: IDBTransactionMode,
    run: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
        let result: T;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error('Voice draft transaction failed.'));
        tx.onabort = () => reject(tx.error ?? new Error('Voice draft transaction aborted.'));
        run(tx, (value) => { result = value; });
      });
    } finally { db.close(); }
  }
  return {
    list: (scope: SpeechScope) => transaction<VoiceDraft[]>(['drafts'], 'readonly', (tx, result) => {
      const request = tx.objectStore('drafts').getAll();
      request.onsuccess = () => result((request.result as VoiceDraft[]).filter((draft) => speechScopeKey(draft) === speechScopeKey(scope)));
    }),
    listLaunch: () => transaction<VoiceDraft[]>(['drafts'], 'readonly', (tx, result) => {
      const request = tx.objectStore('drafts').getAll();
      request.onsuccess = () => result((request.result as VoiceDraft[]).filter((draft) => Boolean(draft.draftId)));
    }),
    append: (id: string, scope: SpeechScope, sampleRate: number, pcm: Float32Array) => {
      if (!pcm.length || sampleRate < 16000 || !Number.isFinite(sampleRate)) return Promise.reject(new Error('Invalid voice draft audio.'));
      return transaction<VoiceDraft>(['drafts', 'chunks'], 'readwrite', (tx, result) => {
        const drafts = tx.objectStore('drafts');
        const request = drafts.get(id);
        request.onsuccess = () => {
          try {
          const existing = request.result as VoiceDraft | undefined;
          const draft = existing ?? { id, ...scope, sampleRate, sampleCount: 0, chunkCount: 0, createdAt: Date.now() };
          if (speechScopeKey(draft) !== speechScopeKey(scope) || draft.sampleRate !== sampleRate
            || draft.sampleCount + pcm.length > sampleRate * 60) { tx.abort(); return; }
          tx.objectStore('chunks').put({ key: `${id}:${draft.chunkCount}`, draftId: id, index: draft.chunkCount, pcm } satisfies StoredChunk);
          const updated = { ...draft, sampleCount: draft.sampleCount + pcm.length, chunkCount: draft.chunkCount + 1 };
          drafts.put(updated); result(updated);
          } catch { tx.abort(); }
        };
      });
    },
    read: (draft: VoiceDraft) => transaction<Float32Array[]>(['drafts', 'chunks'], 'readonly', (tx, result) => {
      const request = tx.objectStore('chunks').index('draftId').getAll(draft.id);
      request.onsuccess = () => {
        const chunks = (request.result as StoredChunk[]).sort((a, b) => a.index - b.index);
        result(chunks.map((chunk) => chunk.pcm));
      };
    }),
    setDelivery: (id: string, text: string, cleanupOnly = true, expectedComposer?: string,
      deliveryState: 'pending' | 'inserted' = 'pending') => transaction<void>(['drafts'], 'readwrite', (tx, result) => {
      const drafts = tx.objectStore('drafts'); const request = drafts.get(id);
      request.onsuccess = () => {
        if (!request.result) { tx.abort(); return; }
        try {
          drafts.put({ ...request.result as VoiceDraft, cleanupOnly, deliveryText: text,
            deliveryState: cleanupOnly ? deliveryState : undefined, expectedComposer });
          result(undefined);
        }
        catch { tx.abort(); }
      };
    }),
    remove: (id: string) => transaction<void>(['drafts', 'chunks'], 'readwrite', (tx, result) => {
      tx.objectStore('drafts').delete(id);
      const cursor = tx.objectStore('chunks').index('draftId').openCursor(IDBKeyRange.only(id));
      cursor.onsuccess = () => {
        if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } else result(undefined);
      };
    }),
  };
}

export const voiceDraftStore = createVoiceDraftStore();

export function createVoiceJournal(id: string, scope: SpeechScope,
  onState: (state: 'saving' | 'saved' | 'error') => void) {
  const batches: Array<{ pcm: Float32Array; rate: number }> = [];
  let pending: Float32Array[] = [];
  let pendingLength = 0;
  let committed = 0;
  let queue = Promise.resolve(true);
  let discarded = false;
  const flush = () => {
    if (discarded) return queue;
    if (pendingLength) {
      const pcm = new Float32Array(pendingLength);
      let offset = 0;
      for (const chunk of pending) { pcm.set(chunk, offset); offset += chunk.length; }
      batches.push({ pcm, rate }); pending = []; pendingLength = 0;
    }
    queue = queue.then(async () => {
      if (discarded || committed === batches.length) return true;
      onState('saving');
      try {
        while (!discarded && committed < batches.length) {
          const batch = batches[committed];
          await voiceDraftStore.append(id, scope, batch.rate, batch.pcm);
          committed++;
        }
        if (!discarded) onState('saved');
        return true;
      } catch { if (!discarded) onState('error'); return false; }
    });
    return queue;
  };
  let rate = 16000;
  return {
    id, scope,
    append: (pcm: Float32Array, sampleRate: number) => {
      if (discarded) return;
      rate = sampleRate;
      pending.push(pcm.slice()); pendingLength += pcm.length;
      onState('saving');
      if (pendingLength >= sampleRate / 4) void flush();
    },
    flush,
    discard: async () => {
      discarded = true;
      await queue;
      await voiceDraftStore.remove(id);
      for (const batch of batches) batch.pcm.fill(0);
      for (const chunk of pending) chunk.fill(0);
      batches.length = 0; pending = []; pendingLength = 0; committed = 0;
    },
    get unsaved() { return pendingLength > 0 || committed < batches.length; },
    clearMemory: () => {
      for (const batch of batches) batch.pcm.fill(0);
      for (const chunk of pending) chunk.fill(0);
      batches.length = 0; pending = []; pendingLength = 0; committed = 0;
    },
  };
}
