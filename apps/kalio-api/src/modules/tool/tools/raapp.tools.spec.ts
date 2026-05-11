/**
 * Unit tests for run_raapp and list_raapps tools.
 *
 * Regression coverage for the bugs reported via screenshot:
 * - run_raapp must exist and return the correct RA-App result structure
 * - run_raapp must return a descriptive error when the ID is not found
 * - run_raapp must return an error when htmlContent is null
 * - list_raapps returns all available apps with id/name/description
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunRaAppTool, ListRaAppsTool, RaAppCreateTool } from './raapp.tools';
import type { RAAppService } from '../../raapp/raapp.service';
import type { LoadedRAApp } from '../../raapp/raapp.service';
import type { RAAppVersioningService } from '../../raapp/raapp-versioning.service';
import type { ToolCallRequest } from '@kalio/types';
import type { EffectsProcessorService } from '../../raapp/effects-processor.service';
import type { RAAppHITLService } from '../../raapp/raapp-hitl.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp(overrides: Partial<LoadedRAApp> = {}): LoadedRAApp {
  return {
    id: 'interactive-qa',
    zipPath: '/apps/interactive-qa.zip',
    meta: {
      id: 'interactive-qa',
      name: 'Interactive Q&A',
      description: 'A simple Q&A interactive app',
      execution: { render_as: 'interactive' },
      input_schema: { type: 'object', properties: { question: { type: 'string' } } },
      tool_description: 'Run Q&A with { question, options, allow_custom }',
    },
    source: 'core',
    htmlContent: '<html><body>Q?</body></html>',
    guiContent: null,
    systemsContent: null,
    appMode: 'interactive',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeRequest(args: Record<string, unknown> = {}): ToolCallRequest {
  return { callId: 'call_test', sessionId: 'sess-test', toolName: 'run_raapp', args };
}

// ── run_raapp tests ───────────────────────────────────────────────────────────

describe('RunRaAppTool', () => {
  let tool: RunRaAppTool;
  let raapp: Partial<RAAppService>;

  beforeEach(() => {
    raapp = {
      getById: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
      init: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn(),
    };
    const mockEffectsProcessor = {
      processSystemsYaml: vi.fn().mockResolvedValue({ output: {}, pendingApprovals: [], entities: [] }),
    } as unknown as EffectsProcessorService;
    const mockHITL = {
      savePendingApprovals: vi.fn().mockResolvedValue([]),
    } as unknown as RAAppHITLService;
    tool = new RunRaAppTool(raapp as RAAppService, mockEffectsProcessor, mockHITL);
  });

  it('returns error with available IDs when app ID is not found', async () => {
    (raapp.getById as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (raapp.getAll as ReturnType<typeof vi.fn>).mockReturnValue([makeApp({ id: 'other-app' })]);

    const result = await tool.execute(makeRequest({ id: 'nonexistent' })) as Record<string, unknown>;

    expect(result.status).toBe('error');
    expect(result.message as string).toContain('nonexistent');
    expect(result.message as string).toContain('other-app');
  });

  it('returns error when app has no htmlContent and no guiContent', async () => {
    (raapp.getById as ReturnType<typeof vi.fn>).mockReturnValue(makeApp({ htmlContent: null, guiContent: null }));

    const result = await tool.execute(makeRequest({ id: 'interactive-qa' })) as Record<string, unknown>;

    expect(result.status).toBe('error');
    expect(result.message as string).toContain('no renderable content');
  });

  it('reloads the RA-App catalog once before failing missing-content apps', async () => {
    const staleApp = makeApp({
      id: 'visual-calculator',
      htmlContent: null,
      guiContent: null,
      systemsContent: 'systems:\n  - id: calc',
    });
    const refreshedApp = makeApp({
      id: 'visual-calculator',
      htmlContent: null,
      guiContent: 'vbox { label { text = "[output.result]" } }',
      systemsContent: 'systems:\n  - id: calc',
      appMode: 'display',
    });
    (raapp.getById as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(staleApp)
      .mockReturnValueOnce(refreshedApp);
    (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'ready',
      renderedContent: '{"nodes":[],"data":{}}',
    });

    const result = await tool.execute(makeRequest({ id: 'visual-calculator', inputs: { a: 12, b: 4, operation: 'add' } })) as Record<string, unknown>;

    expect(raapp.init).toHaveBeenCalledOnce();
    expect(result.status).toBe('ready');
    expect(result.type).toBe('gui');
  });

  it('returns the existing no-renderable-content error when catalog reload itself fails', async () => {
    (raapp.getById as ReturnType<typeof vi.fn>).mockReturnValue(
      makeApp({ id: 'visual-calculator', htmlContent: null, guiContent: null }),
    );
    (raapp.init as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk busy'));

    const result = await tool.execute(makeRequest({ id: 'visual-calculator' })) as Record<string, unknown>;

    expect(raapp.init).toHaveBeenCalledOnce();
    expect(result.status).toBe('error');
    expect(result.message).toBe('RA-App "visual-calculator" has no renderable content (missing main.html, index.html, or ui.gui in the zip).');
  });

  it('returns ready block with correct structure when app executes successfully', async () => {
    const app = makeApp();
    (raapp.getById as ReturnType<typeof vi.fn>).mockReturnValue(app);
    (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'ok',
      renderedContent: app.htmlContent,
    });

    const result = await tool.execute(makeRequest({ id: 'interactive-qa' })) as Record<string, unknown>;

    expect(result.status).toBe('ready');
    expect(result.type).toBe('html');
    expect(result.mode).toBe('interactive');
    expect(result.content).toBe(app.htmlContent);
    expect(result.renderedContent).toBe(app.htmlContent);
  });

  it('propagates execute error when raapp.execute returns error status', async () => {
    const app = makeApp();
    (raapp.getById as ReturnType<typeof vi.fn>).mockReturnValue(app);
    (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'error',
      error: { code: 'EXEC_FAIL', message: 'execution failed' },
    });

    const result = await tool.execute(makeRequest({ id: 'interactive-qa' })) as Record<string, unknown>;

    expect(result.status).toBe('error');
    expect(result.message).toBe('execution failed');
  });

  it('calls raapp.execute with the app htmlContent and appMode', async () => {
    const app = makeApp({ appMode: 'display' });
    (raapp.getById as ReturnType<typeof vi.fn>).mockReturnValue(app);
    (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'ok',
      renderedContent: app.htmlContent,
    });

    await tool.execute(makeRequest({ id: 'interactive-qa' }));

    expect(raapp.execute).toHaveBeenCalledWith({
      type: 'html',
      mode: 'display',
      content: app.htmlContent,
    });
  });

  it('executes systems.yml and merges computed outputs into GUI data', async () => {
    const app = makeApp({
      id: 'visual-calculator',
      guiContent: 'vbox { label { text = "[output.result]" } }',
      htmlContent: null,
      systemsContent: 'systems:\n  - id: calc\n    effects:\n      - assign:\n          target: output.result\n          expression: input.a + input.b',
      appMode: 'display',
    });
    (raapp.getById as ReturnType<typeof vi.fn>).mockReturnValue(app);
    (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'ready',
      renderedContent: '{"nodes":[],"data":{}}',
    });
    // effectsProcessor mock is set up in beforeEach to return { output: {}, pendingApprovals: [] }
    // Override with a result for this test
    const mockEffectsProcessor = {
      processSystemsYaml: vi.fn().mockResolvedValue({ output: { result: 8 }, pendingApprovals: [], entities: [] }),
    } as unknown as EffectsProcessorService;
    const mockHITL = {
      savePendingApprovals: vi.fn().mockResolvedValue([]),
    } as unknown as RAAppHITLService;
    tool = new RunRaAppTool(raapp as RAAppService, mockEffectsProcessor, mockHITL);

    const result = await tool.execute(makeRequest({ id: 'visual-calculator', inputs: { a: 5, b: 3 } })) as Record<string, unknown>;

    expect(result.status).toBe('ready');
    expect(mockEffectsProcessor.processSystemsYaml).toHaveBeenCalledWith(
      app.systemsContent,
      { a: 5, b: 3 },
      expect.objectContaining({ sessionId: expect.any(String) }),
      expect.any(Object), // EntityStore instance
    );
    expect(raapp.execute).toHaveBeenCalledWith(
      { type: 'gui', mode: 'display', content: app.guiContent },
      { output: { a: 5, b: 3, result: 8 } },
    );
  });
});

// ── list_raapps tests ─────────────────────────────────────────────────────────

describe('ListRaAppsTool', () => {
  let tool: ListRaAppsTool;
  let raapp: Partial<RAAppService>;

  beforeEach(() => {
    raapp = { getAll: vi.fn() };
    tool = new ListRaAppsTool(raapp as RAAppService);
  });

  it('returns count=0 and empty array when no apps are loaded', async () => {
    (raapp.getAll as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const result = await tool.execute(makeRequest()) as Record<string, unknown>;

    expect(result.count).toBe(0);
    expect(result.apps).toEqual([]);
  });

  it('returns correct summary for each loaded app', async () => {
    (raapp.getAll as ReturnType<typeof vi.fn>).mockReturnValue([
      makeApp({ id: 'quiz', meta: { id: 'quiz', name: 'Quiz App', description: 'A quiz', tags: ['fun'], input_schema: { type: 'object', properties: { q: { type: 'string' } } }, tool_description: 'Quiz tool' } as LoadedRAApp['meta'], appMode: 'interactive', source: 'core' }),
      makeApp({ id: 'report', meta: { id: 'report', name: 'Report View', description: '', input_schema: null, tool_description: '' } as LoadedRAApp['meta'], appMode: 'display', source: 'user' }),
    ]);

    const result = await tool.execute(makeRequest()) as { count: number; apps: Record<string, unknown>[] };

    expect(result.count).toBe(2);
    expect(result.apps[0]).toMatchObject({ id: 'quiz', name: 'Quiz App', description: 'A quiz', tags: ['fun'], mode: 'interactive', source: 'core', input_schema: { type: 'object', properties: { q: { type: 'string' } } }, tool_description: 'Quiz tool' });
    expect(result.apps[1]).toMatchObject({ id: 'report', name: 'Report View', description: '', tags: [], mode: 'display', source: 'user', input_schema: null, tool_description: '' });
  });
});

// ── Persona skills regression ─────────────────────────────────────────────────

describe('REGRESSION: ra-apps persona skills include run_raapp and list_raapps', () => {
  it('run_raapp and list_raapps tools are exported from raapp.tools.ts', async () => {
    // Import dynamically to verify the exports exist
    const mod = await import('./raapp.tools');
    expect(typeof mod.RunRaAppTool).toBe('function');
    expect(typeof mod.ListRaAppsTool).toBe('function');
  });
});

describe('RaAppCreateTool', () => {
  it('publishes optional-title apps through versioned release storage', async () => {
    const execute = vi.fn().mockResolvedValue({ status: 'ready', renderedContent: '<html></html>' });
    const init = vi.fn().mockResolvedValue(undefined);
    const saveGeneratedApp = vi.fn();
    const saveAsDraft = vi.fn().mockResolvedValue({
      slug: 'generated-sid-1-12345678',
      name: 'Kocia Strona',
      source: 'user',
      current: {
        version: '1.0.0',
        status: 'current',
        zipPath: '/tmp/current.zip',
        createdAt: 1,
        meta: { id: 'generated-sid-1-12345678', name: 'Kocia Strona', version: '1.0.0' },
      },
      history: [],
    });
    const raapp = {
      execute,
      init,
      saveGeneratedApp,
    } as unknown as RAAppService;
    const versioning = {
      saveAsDraft,
    } as unknown as RAAppVersioningService;
    const tool = new RaAppCreateTool(raapp, versioning);

    const result = await tool.execute({
      callId: 'call-1',
      sessionId: 'sid-1',
      toolName: 'raapp_create',
      args: {
        type: 'html',
        content: '<html><head><title>Koty</title></head></html>',
        mode: 'display',
        title: 'Kocia Strona',
      },
    }) as Record<string, unknown>;

    expect(execute).toHaveBeenCalledWith({
      type: 'html',
      mode: 'display',
      content: '<html><head><title>Koty</title></head></html>',
    });

    expect(saveAsDraft).toHaveBeenCalledWith(
      expect.stringMatching(/^generated-sid-1-/),
      expect.any(Buffer),
    );
    expect(saveGeneratedApp).not.toHaveBeenCalled();
    expect(init).toHaveBeenCalledOnce();
    expect(result.storedAppId).toMatch(/^generated-sid-1-/);

    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(saveAsDraft.mock.invocationCallOrder[0]);
  });
});
