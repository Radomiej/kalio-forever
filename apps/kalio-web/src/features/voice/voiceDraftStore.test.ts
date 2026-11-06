// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import ts from 'typescript';
import source from './voiceDraftStore.ts?raw';
import type { createVoiceJournal, createVoiceDraftStore } from './voiceDraftStore';

type Store = ReturnType<typeof createVoiceDraftStore>;
declare global { interface Window { testVoiceStore: Store; testVoiceJournal: typeof createVoiceJournal; testVoiceDefaultStore: Store } }

describe('actual browser voice journal', () => {
  it('acknowledges durable chunks, survives reload, isolates sessions and deletes only explicitly', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route('http://localhost:19099/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated voice draft test</title>' }));
      await page.goto('http://localhost:19099/');
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      const script = `var exports = {}; ${compiled}\nwindow.testVoiceStore = exports.createVoiceDraftStore('voice-test'); window.testVoiceJournal = exports.createVoiceJournal; window.testVoiceDefaultStore = exports.voiceDraftStore;`;
      await page.addScriptTag({ content: script });
      await page.evaluate(async () => {
        await window.testVoiceStore.append('draft1', { sessionId: 's1' }, 48000, new Float32Array([0.1, 0.2]));
        await window.testVoiceStore.append('draft1', { sessionId: 's1' }, 48000, new Float32Array([0.3]));
        await window.testVoiceStore.append('draft2', { sessionId: 's2' }, 16000, new Float32Array([0.4]));
        await window.testVoiceStore.append('launch-audio', { draftId: 'launch-scope' }, 16000, new Float32Array([0.5, 0.6]));
        await window.testVoiceStore.setDelivery('launch-audio', 'Text already handed to composer');
        await window.testVoiceStore.setDelivery('draft1', 'Committed answer', true, 'Committed answer', 'inserted');
      });
      await page.reload(); await page.addScriptTag({ content: script });
      const recovered = await page.evaluate(async () => {
        const drafts = await window.testVoiceStore.list({ sessionId: 's1' });
        const pcm = await window.testVoiceStore.read(drafts[0]);
        return { ids: drafts.map((draft) => draft.id), deliveryState: drafts[0].deliveryState, count: drafts[0].sampleCount, chunks: pcm.map((chunk) => Array.from(chunk)) };
      });
      expect(recovered.ids).toEqual(['draft1']); expect(recovered.count).toBe(3);
      expect(recovered.deliveryState).toBe('inserted');
      expect(recovered.chunks).toHaveLength(2); expect(recovered.chunks[1][0]).toBeCloseTo(0.3);
      const launch = await page.evaluate(async () => {
        const drafts = await window.testVoiceStore.list({ draftId: 'launch-scope' });
        const pcm = await window.testVoiceStore.read(drafts[0]);
        return { draft: drafts[0], samples: Array.from(pcm[0]), visibleAfterLaunch: await window.testVoiceStore.listLaunch() };
      });
      expect(launch.draft).toMatchObject({ draftId: 'launch-scope', sampleCount: 2 });
      expect(launch.draft).toMatchObject({ cleanupOnly: true, deliveryState: 'pending', deliveryText: 'Text already handed to composer' });
      expect(launch.draft).not.toHaveProperty('sessionId');
      expect(launch.samples[0]).toBeCloseTo(0.5);
      expect(launch.visibleAfterLaunch.map((draft) => draft.id)).toEqual(['launch-audio']);
      const discarded = await page.evaluate(async () => {
        const store = window.testVoiceDefaultStore;
        const append = store.append;
        let release!: () => void;
        let started!: () => void;
        const writing = new Promise<void>((resolve) => { started = resolve; });
        const gate = new Promise<void>((resolve) => { release = resolve; });
        store.append = async (...args) => { started(); await gate; return append(...args); };
        try {
          const journal = window.testVoiceJournal('cancel-race', { sessionId: 'race' }, () => undefined);
          journal.append(new Float32Array(4000).fill(0.2), 16000);
          await writing;
          const deleting = journal.discard();
          journal.append(new Float32Array(4000).fill(0.3), 16000);
          const lateFlush = journal.flush();
          release(); await deleting; await lateFlush;
          return await store.list({ sessionId: 'race' });
        } finally { store.append = append; }
      });
      expect(discarded).toEqual([]);
      await page.reload(); await page.addScriptTag({ content: script });
      expect(await page.evaluate(() => window.testVoiceDefaultStore.list({ sessionId: 'race' }))).toEqual([]);
      await page.evaluate(() => window.testVoiceStore.remove('draft1'));
      expect(await page.evaluate(() => window.testVoiceStore.list({ sessionId: 's1' }))).toEqual([]);
      expect(await page.evaluate(async () => (await window.testVoiceStore.list({ sessionId: 's2' })).map((draft) => draft.id))).toEqual(['draft2']);
    } finally { await browser.close(); }
  }, 20000);
  it('rejects quota failure instead of acknowledging an uncommitted recording', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route('http://localhost:19099/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
      await page.goto('http://localhost:19099/');
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      await page.addScriptTag({ content: `var exports = {}; ${compiled}\nwindow.testVoiceStore = exports.createVoiceDraftStore('quota-test');` });
      const result = await page.evaluate(async () => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = () => { throw new DOMException('Quota full', 'QuotaExceededError'); };
        let rejected = false;
        try { await window.testVoiceStore.append('draft', { sessionId: 's1' }, 16000, new Float32Array([1])); }
        catch { rejected = true; }
        finally { IDBObjectStore.prototype.put = put; }
        return { rejected, drafts: await window.testVoiceStore.list({ sessionId: 's1' }) };
      });
      expect(result).toEqual({ rejected: true, drafts: [] });
    } finally { await browser.close(); }
  }, 20000);
});
