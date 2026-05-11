import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RAAppService } from './raapp.service';
import { deriveGeneratedAppName } from './raapp.service';
import type { LoadedRAApp } from './raapp.service';
import { archiveDirectoryToZip } from './zip-archive.util';

// AC-13: RA-App DSL parse error is returned inline (not thrown), with code DSL_PARSE_ERROR

describe('RAAppService', () => {
  let service: RAAppService;

  async function createService(configOverrides?: Record<string, unknown>): Promise<RAAppService> {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RAAppService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def: unknown) =>
              Object.prototype.hasOwnProperty.call(configOverrides ?? {}, key)
                ? configOverrides?.[key]
                : def,
          },
        },
      ],
    }).compile();

    return moduleRef.get<RAAppService>(RAAppService);
  }

  beforeEach(async () => {
    service = await createService();
  });

  describe('init — packaged core fallback', () => {
    it('loads shipped core apps when runtime data directory is absent', async () => {
      const originalCwd = process.cwd();
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalio-raapp-cwd-'));

      try {
        process.chdir(tempRoot);

        const isolatedService = await createService();
        await isolatedService.init();

        const ids = isolatedService.getAll().map((app) => app.id);
        expect(ids).toContain('qa-interactive');
        expect(ids).toContain('visual-calculator');

        const visualCalculator = isolatedService.getById('visual-calculator');
        expect(visualCalculator?.meta.input_schema).toEqual({
          type: 'object',
          required: ['a', 'b', 'operation'],
          properties: {
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' },
            operation: {
              type: 'string',
              description: 'Operation to perform',
              enum: ['add', 'subtract', 'multiply', 'divide'],
            },
          },
        });
        expect(visualCalculator?.guiContent).toContain('[output.result]');
        expect(visualCalculator?.guiContent).not.toContain('text = "[result]"');
      } finally {
        process.chdir(originalCwd);
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    });

    it('keeps the more renderable duplicate when the same app id appears twice in runtime core', async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalio-raapp-dup-'));
      const coreDir = path.join(tempRoot, 'core');
      const unpackedDir = path.join(coreDir, 'visual-calculator-extracted');
      const staleZipSourceDir = path.join(tempRoot, 'stale-visual-calculator');
      const staleZipPath = path.join(coreDir, 'visual-calculator.zip');

      await fs.mkdir(unpackedDir, { recursive: true });
      await fs.mkdir(staleZipSourceDir, { recursive: true });

      const meta = [
        'id: visual-calculator',
        'name: Visual Calculator',
        'version: "1.0"',
        'description: Duplicate loader regression fixture',
        'execution:',
        '  render_as: display',
      ].join('\n');

      await fs.writeFile(path.join(unpackedDir, 'meta.yml'), meta, 'utf8');
      await fs.writeFile(path.join(unpackedDir, 'ui.gui'), 'vbox { label { text = "rendered" } }', 'utf8');
      await fs.writeFile(path.join(staleZipSourceDir, 'meta.yml'), meta, 'utf8');
      await archiveDirectoryToZip({ sourceDir: staleZipSourceDir, zipPath: staleZipPath });

      const isolatedService = await createService({ RA_APPS_PATH: tempRoot });

      try {
        await isolatedService.init();

        const app = isolatedService.getById('visual-calculator');
        expect(app).toBeDefined();
        expect(app?.guiContent).toContain('rendered');
        expect(app?.zipPath.endsWith('visual-calculator-extracted')).toBe(true);
      } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    });

    it('logs when an equal-score duplicate replaces an existing app', async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalio-raapp-equal-dup-'));
      const coreDir = path.join(tempRoot, 'core');
      const firstZipSourceDir = path.join(tempRoot, 'visual-calculator-a');
      const secondZipSourceDir = path.join(tempRoot, 'visual-calculator-b');
      const firstZipPath = path.join(coreDir, 'a-visual-calculator.zip');
      const secondZipPath = path.join(coreDir, 'b-visual-calculator.zip');

      await fs.mkdir(coreDir, { recursive: true });
      await fs.mkdir(firstZipSourceDir, { recursive: true });
      await fs.mkdir(secondZipSourceDir, { recursive: true });

      const meta = [
        'id: visual-calculator',
        'name: Visual Calculator',
        'version: "1.0"',
        'description: Duplicate loader logging fixture',
        'execution:',
        '  render_as: display',
      ].join('\n');

      await fs.writeFile(path.join(firstZipSourceDir, 'meta.yml'), meta, 'utf8');
      await fs.writeFile(path.join(firstZipSourceDir, 'ui.gui'), 'vbox { label { text = "first" } }', 'utf8');
      await fs.writeFile(path.join(secondZipSourceDir, 'meta.yml'), meta, 'utf8');
      await fs.writeFile(path.join(secondZipSourceDir, 'ui.gui'), 'vbox { label { text = "second" } }', 'utf8');
      await archiveDirectoryToZip({ sourceDir: firstZipSourceDir, zipPath: firstZipPath });
      await archiveDirectoryToZip({ sourceDir: secondZipSourceDir, zipPath: secondZipPath });

      const isolatedService = await createService({ RA_APPS_PATH: tempRoot });
      const warnSpy = vi.spyOn((isolatedService as unknown as { logger: { warn: (message: string) => void } }).logger, 'warn');

      try {
        await isolatedService.init();

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Replacing duplicate RA-App visual-calculator'));
      } finally {
        warnSpy.mockRestore();
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    });
  });

  describe('deriveGeneratedAppName', () => {
    it('prefers explicit title when provided', () => {
      const name = deriveGeneratedAppName({
        type: 'html',
        content: '<html><head><title>Ignored</title></head></html>',
        mode: 'display',
        sessionId: 'sid',
        title: '  Cat Landing Page  ',
      });

      expect(name).toBe('Cat Landing Page');
    });

    it('extracts title from html <title> tag', () => {
      const name = deriveGeneratedAppName({
        type: 'html',
        content: '<html><head><title>All About Cats</title></head><body></body></html>',
        mode: 'display',
        sessionId: 'sid',
      });

      expect(name).toBe('All About Cats');
    });

    it('falls back to html <h1> when <title> is missing', () => {
      const name = deriveGeneratedAppName({
        type: 'html',
        content: '<html><body><h1>Cat H1 Title</h1></body></html>',
        mode: 'display',
        sessionId: 'sid',
      });

      expect(name).toBe('Cat H1 Title');
    });

    it('extracts title from gui DSL assignment', () => {
      const name = deriveGeneratedAppName({
        type: 'gui',
        content: 'title = "Koty - Dashboard"\nvbox { label { text = "hello" } }',
        mode: 'display',
        sessionId: 'sid',
      });

      expect(name).toBe('Koty - Dashboard');
    });

    it('falls back to extracted html title when explicit title is blank', () => {
      const name = deriveGeneratedAppName({
        type: 'html',
        content: '<html><head><title>Real Title</title></head><body></body></html>',
        mode: 'display',
        sessionId: 'sid',
        title: '   ',
      });

      expect(name).toBe('Real Title');
    });

    it('extracts title from gui DSL when using single quotes', () => {
      const name = deriveGeneratedAppName({
        type: 'gui',
        content: "title = 'Koty - Single Quote'\nvbox { label { text = 'hello' } }",
        mode: 'display',
        sessionId: 'sid',
      });

      expect(name).toBe('Koty - Single Quote');
    });

    it('ignores non-string explicit title and falls back to extracted html title', () => {
      const name = deriveGeneratedAppName({
        type: 'html',
        content: '<html><head><title>Fallback Title</title></head><body></body></html>',
        mode: 'display',
        sessionId: 'sid',
        title: { bad: true } as unknown as string,
      });

      expect(name).toBe('Fallback Title');
    });

    it('returns generated fallback when nothing can be extracted', () => {
      const name = deriveGeneratedAppName({
        type: 'gui',
        content: 'vbox { label { text = "no title" } }',
        mode: 'display',
        sessionId: 'sid',
      });

      expect(name).toMatch(/^Generated GUI /);
    });
  });

  describe('parse — AC-13: DSL parse errors are inline, not thrown', () => {
    it('returns DSL_PARSE_ERROR for empty string', () => {
      const result = service.parse('');

      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('DSL_PARSE_ERROR');
      expect(result.error?.message).toBeDefined();
    });

    it('returns DSL_PARSE_ERROR for null-like input', () => {
      const result = service.parse(null as unknown as string);

      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('DSL_PARSE_ERROR');
    });

    it('does not throw for invalid input — returns error object', () => {
      expect(() => service.parse('')).not.toThrow();
      expect(() => service.parse(undefined as unknown as string)).not.toThrow();
    });

    it('returns ready status for valid content', () => {
      const result = service.parse('<div>Hello World</div>');

      expect(result.status).toBe('ready');
      expect(result.renderedContent).toBe('<div>Hello World</div>');
    });
  });

  describe('execute — HTML blocks', () => {
    it('returns ready with original content for html blocks', async () => {
      const result = await service.execute({ type: 'html', mode: 'display', content: '<p>test</p>' });

      expect(result.status).toBe('ready');
      expect(result.renderedContent).toBe('<p>test</p>');
    });
  });

  describe('execute — GUI DSL blocks', () => {
    it('returns ready with nodes+data JSON for valid gui DSL', async () => {
      const dsl = `vbox { label { text = "Hello" } }`;
      const result = await service.execute({ type: 'gui', mode: 'display', content: dsl });

      expect(result.status).toBe('ready');
      expect(result.renderedContent).toBeDefined();
      const parsed = JSON.parse(result.renderedContent!);
      expect(parsed).toHaveProperty('nodes');
      expect(parsed).toHaveProperty('data');
      expect(Array.isArray(parsed.nodes)).toBe(true);
    });

    it('returns DSL_PARSE_ERROR for invalid gui DSL', async () => {
      const result = await service.execute({ type: 'gui', mode: 'display', content: 'invalid )))' });

      expect(result.status).toBe('error');
      expect(result.error?.code).toMatch(/DSL_PARSE_ERROR|DSL_EXEC_ERROR/);
    });

    it('does not throw when gui DSL parse fails', async () => {
      await expect(
        service.execute({ type: 'gui', mode: 'display', content: '{ unclosed' }),
      ).resolves.toMatchObject({ status: 'error' });
    });
  });

  describe('delete', () => {
    it('removes unpacked user apps stored as directories', async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalio-raapp-delete-'));
      const isolatedService = await createService({ RA_APPS_PATH: tempRoot });
      const appDir = path.join(tempRoot, 'user', 'dir-app');

      await fs.mkdir(appDir, { recursive: true });
      await fs.writeFile(path.join(appDir, 'meta.yml'), 'id: dir-app\nname: Dir App\n', 'utf8');

      const loaded = (isolatedService as unknown as { loaded: Map<string, LoadedRAApp> }).loaded;
      loaded.set('dir-app', {
        id: 'dir-app',
        zipPath: appDir,
        meta: { id: 'dir-app', name: 'Dir App' },
        source: 'user',
        htmlContent: '<p>dir app</p>',
        guiContent: null,
        systemsContent: null,
        appMode: 'display',
        createdAt: 0,
        updatedAt: 0,
      } as LoadedRAApp);

      try {
        await isolatedService.delete('dir-app');

        await expect(fs.access(appDir)).rejects.toThrow();
        expect(isolatedService.getById('dir-app')).toBeUndefined();
      } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    });
  });
});
