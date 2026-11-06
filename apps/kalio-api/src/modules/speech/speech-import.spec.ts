import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import { SpeechRuntimeStorageService } from '../vfs/speech-runtime-storage.service';
import { SPEECH_MODEL_FILES } from './speech-catalog';

/** Explicit private operator action only; no app endpoint or workspace reconfiguration. */
describe.skipIf(process.env['SPEECH_IMPORT_TEST'] !== '1')('private verified speech install import', () => {
  it('streams and rehashes a ready source into the explicitly selected existing workspace', async () => {
    const targetPath = process.env['SPEECH_IMPORT_TARGET_WORKSPACE_ROOT'];
    if (!targetPath) throw new Error('SPEECH_IMPORT_TARGET_REQUIRED');
    const sourcePath = process.env['SPEECH_IMPORT_SOURCE_WORKSPACE_ROOT'] ?? '../../data/workspaces';
    const source = new SpeechRuntimeStorageService(new ConfigService({ WORKSPACE_ROOT: resolve(sourcePath) }));
    const target = new SpeechRuntimeStorageService(new ConfigService({ WORKSPACE_ROOT: resolve(targetPath) }));
    const sourceRoot = await source.installedRoot(SPEECH_MODEL_FILES);
    expect(sourceRoot).toBeTruthy();
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('IMPORT_MUST_NOT_DOWNLOAD'));
    try {
      const root = await target.importVerifiedInstall(source, SPEECH_MODEL_FILES, new AbortController().signal, () => undefined);
      expect(await target.installedRoot(SPEECH_MODEL_FILES)).toBe(root);
      expect(await source.installedRoot(SPEECH_MODEL_FILES)).toBe(sourceRoot);
      expect(network).not.toHaveBeenCalled();
      console.info('speech-private-import', JSON.stringify({ root, sourcePreserved: true, allEntriesRehashed: true, networkCalls: 0 }));
    } finally { network.mockRestore(); }
  }, 180000);
});
