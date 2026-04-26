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
import { RunRaAppTool, ListRaAppsTool } from './raapp.tools';
import type { RAAppService } from '../../raapp/raapp.service';
import type { LoadedRAApp } from '../../raapp/raapp.service';
import type { ToolCallRequest } from '@kalio/types';

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
      execute: vi.fn(),
      executeSystems: vi.fn().mockResolvedValue({}),
    };
    tool = new RunRaAppTool(raapp as RAAppService);
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
    (raapp.executeSystems as ReturnType<typeof vi.fn>).mockResolvedValue({ result: 8 });

    const result = await tool.execute(makeRequest({ id: 'visual-calculator', inputs: { a: 5, b: 3 } })) as Record<string, unknown>;

    expect(result.status).toBe('ready');
    expect(raapp.executeSystems).toHaveBeenCalledWith(app.systemsContent, { a: 5, b: 3 });
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
