import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { RAAppService } from './raapp.service';
import { EffectsProcessorService } from './effects-processor.service';
import { NativeSystemRegistry } from './native/native-system-registry.service';
import type { AuditService } from '../chat/audit.service';
import type { RAAppHITLService } from './raapp-hitl.service';
import { RunRaAppTool } from '../tool/tools/raapp.tools';

const shippedRoot = path.resolve(__dirname, '../../assets/ra-apps/core/qa-interactive');
let tempRoot: string | undefined;
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

async function loadCatalog(legacyLocation?: 'core' | 'user', change?: 'meta' | 'gui' | 'systems' | 'extra' | 'version') {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalio-qa-core-upgrade-'));
  const runtimeApp = path.join(tempRoot, 'data/ra-apps', legacyLocation ?? 'core', 'qa-interactive');
  if (legacyLocation) {
    await fs.cp(shippedRoot, runtimeApp, { recursive: true });
    const metaPath = path.join(runtimeApp, 'meta.yml');
    const meta = (await fs.readFile(metaPath, 'utf8'))
      .replace('"1.1.1"', '"1.1.0"').replaceAll('render_as: interactive', 'render_as: gui')
      .replace(/\r?\n$/, ''); // The frozen shipped 1.1.0 metadata had no trailing newline.
    await fs.writeFile(metaPath, meta, 'utf8');
    if (change === 'meta') await fs.appendFile(metaPath, '\n# Owner customization\n');
    if (change === 'gui') await fs.appendFile(path.join(runtimeApp, 'ui.gui'), '\n');
    if (change === 'systems') await fs.appendFile(path.join(runtimeApp, 'systems.yml'), '\n');
    if (change === 'extra') await fs.writeFile(path.join(runtimeApp, 'tests.yml'), 'tests: []\n');
    if (change === 'version') await fs.writeFile(metaPath, meta.replace('"1.1.0"', '"9.9.9"'));
  }
  process.chdir(tempRoot);
  const service = new RAAppService(new ConfigService());
  await service.init();
  return { service, runtimeApp };
}

async function createTool() {
  const { service } = await loadCatalog();
  const effects = new EffectsProcessorService(new NativeSystemRegistry(),
    { log: vi.fn() } as unknown as AuditService, new ConfigService());
  return new RunRaAppTool(service, effects, {} as RAAppHITLService);
}

describe('shipped qa-interactive through run_raapp', () => {
  it('loads the interactive shipped patch without changing sibling modes', async () => {
    const { service } = await loadCatalog();
    expect(service.getById('qa-interactive')).toMatchObject({ appMode: 'interactive', meta: { version: '1.1.1' } });
    expect(service.getById('visual-calculator')?.appMode).toBe('display');
  });

  it('selects the packaged patch over exact unchanged legacy core without overwriting it', async () => {
    const { service, runtimeApp } = await loadCatalog('core');
    const names = ['meta.yml', 'ui.gui', 'systems.yml'];
    const before = await Promise.all(names.map((name) => fs.readFile(path.join(runtimeApp, name))));
    expect(service.getById('qa-interactive')).toMatchObject({ zipPath: shippedRoot, appMode: 'interactive', meta: { version: '1.1.1' } });
    expect(await fs.readFile(path.join(runtimeApp, 'meta.yml'), 'utf8')).toContain('version: "1.1.0"');
    await service.init();
    expect(service.getById('qa-interactive')?.zipPath).toBe(shippedRoot);
    expect(await Promise.all(names.map((name) => fs.readFile(path.join(runtimeApp, name))))).toEqual(before);
  });

  it('respects an explicitly configured core catalog with no packaged fallback', async () => {
    const { runtimeApp } = await loadCatalog('core');
    const service = new RAAppService(new ConfigService({ RA_APPS_PATH: path.dirname(path.dirname(runtimeApp)) }));
    await service.init();
    expect(service.getById('qa-interactive')).toMatchObject({ zipPath: runtimeApp, appMode: 'display' });
  });

  it.each(['meta', 'gui', 'systems', 'extra', 'version'] as const)('preserves modified runtime core: %s', async (change) => {
    const { service, runtimeApp } = await loadCatalog('core', change);
    expect(service.getById('qa-interactive')).toMatchObject({ zipPath: runtimeApp, appMode: 'display' });
  });

  it('preserves even an unchanged user copy', async () => {
    const { service, runtimeApp } = await loadCatalog('user');
    expect(service.getById('qa-interactive')).toMatchObject({ zipPath: runtimeApp, source: 'user', appMode: 'display' });
  });
  it.each([
    undefined, {}, { question: ' ', options: ['Yes'] },
    { question: 'Ready?', options: [] }, { question: 'Ready?', options: [' '] },
    { question: 'Ready?', options: [42] },
  ])('rejects missing or empty Q&A data instead of rendering ready: %j', async (inputs) => {
    const tool = await createTool();
    const result = await tool.execute({ callId: 'qa-test', sessionId: 'session',
      toolName: 'run_raapp', args: { id: 'qa-interactive', ...(inputs ? { inputs } : {}) } });
    expect(result).toMatchObject({ status: 'error', message: expect.stringContaining('question') });
  });

  it('preserves generated question and clickable answer bindings in the durable JSON payload', async () => {
    const tool = await createTool();
    const result = await tool.execute({ callId: 'qa-test', sessionId: 'session', toolName: 'run_raapp',
      args: { id: 'qa-interactive', inputs: { question: 'Which runtime?', options: ['OpenRouter', 'Devin'] } },
    }) as { status: string; mode: string; renderedContent: string };
    expect(result.status).toBe('ready');
    expect(result.mode).toBe('interactive');
    const payload = JSON.parse(result.renderedContent);
    expect(payload.data.output).toMatchObject({ question: 'Which runtime?', option_0: 'OpenRouter', option_1: 'Devin' });
    expect(result.renderedContent).toContain('I choose: [output.option_0]');
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});
