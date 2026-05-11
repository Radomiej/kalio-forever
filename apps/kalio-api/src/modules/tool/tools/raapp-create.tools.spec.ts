/**
 * Unit tests for RaAppCreateTool and RaAppCompileTool.
 * run_raapp and list_raapps are covered in raapp.tools.spec.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { RaAppCreateTool, RaAppCompileTool } from './raapp.tools';
import type { RAAppService } from '../../raapp/raapp.service';
import type { RAAppSandboxService } from '../../raapp/raapp-sandbox.service';
import type { RAAppVersioningService } from '../../raapp/raapp-versioning.service';
import type { ToolCallRequest } from '@kalio/types';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';

function makeRequest(toolName: string, args: Record<string, unknown> = {}): ToolCallRequest {
  return { callId: 'call-1', sessionId: 'sess-ra', toolName, args };
}

const reflector = new Reflector();

// ── RaAppCreateTool ───────────────────────────────────────────────────────────

describe('RaAppCreateTool', () => {
  let tool: RaAppCreateTool;
  let raapp: Partial<RAAppService>;
  let versioning: Partial<RAAppVersioningService>;

  beforeEach(() => {
    raapp = {
      execute: vi.fn(),
      init: vi.fn().mockResolvedValue(undefined),
      saveGeneratedApp: vi.fn().mockResolvedValue({ id: 'generated-default' }),
    };
    versioning = {
      saveAsDraft: vi.fn().mockResolvedValue({
        slug: 'generated-sess-ra-abcd1234',
        name: 'Generated App',
        source: 'user',
        current: {
          version: '1.0.0',
          status: 'current',
          zipPath: '/tmp/current.zip',
          createdAt: 1,
          meta: { id: 'generated-sess-ra-abcd1234', name: 'Generated App', version: '1.0.0' },
        },
        history: [],
      }),
      approveDraft: vi.fn(),
    };
    tool = new RaAppCreateTool(raapp as RAAppService, versioning as RAAppVersioningService);
  });

  it('REGRESSION: requires confirmation because it persists generated RA-Apps', () => {
    const metadata = reflector.get(TOOL_METADATA, RaAppCreateTool);

    expect(metadata.requiresConfirmation).toBe(true);
  });

  describe('positive scenarios', () => {
    it('returns ready block for HTML type with renderedContent', async () => {
      (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'ok',
        renderedContent: '<html>hello</html>',
      });

      const result = await tool.execute(
        makeRequest('raapp_create', { type: 'html', content: '<html>hello</html>' }),
      ) as Record<string, unknown>;

      expect(result.status).toBe('ready');
      expect(result.type).toBe('html');
      expect(result.mode).toBe('display');
      expect(result.content).toBe('<html>hello</html>');
      expect(result.renderedContent).toBe('<html>hello</html>');
    });

    it('returns ready block for GUI DSL type', async () => {
      (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'ok',
        renderedContent: '<div>gui output</div>',
      });

      const result = await tool.execute(
        makeRequest('raapp_create', { type: 'gui', content: 'label: Hello', mode: 'interactive' }),
      ) as Record<string, unknown>;

      expect(result.status).toBe('ready');
      expect(result.type).toBe('gui');
      expect(result.mode).toBe('interactive');
    });

    it('passes type, mode, content to raapp.execute', async () => {
      (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'ok',
        renderedContent: '',
      });

      await tool.execute(
        makeRequest('raapp_create', { type: 'html', content: '<p>hi</p>', mode: 'interactive' }),
      );

      expect(raapp.execute).toHaveBeenCalledWith({
        type: 'html',
        mode: 'interactive',
        content: '<p>hi</p>',
      });
    });

    it('publishes generated app in versioned release storage and returns storedAppId', async () => {
      (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'ok',
        renderedContent: '<html>hello</html>',
      });

      const result = await tool.execute(
        makeRequest('raapp_create', { type: 'html', content: '<html>hello</html>', mode: 'display' }),
      ) as Record<string, unknown>;

      expect(versioning.saveAsDraft).toHaveBeenCalledWith(
        expect.stringMatching(/^generated-sess-ra-/),
        expect.any(Buffer),
      );
      expect(versioning.approveDraft).not.toHaveBeenCalled();
      expect(raapp.saveGeneratedApp).not.toHaveBeenCalled();
      expect(raapp.init).toHaveBeenCalledOnce();
      expect(result.storedAppId).toMatch(/^generated-sess-ra-/);
    });
  });

  describe('edge cases', () => {
    it('defaults mode to "display" when not provided', async () => {
      (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'ok',
        renderedContent: '',
      });

      const result = await tool.execute(
        makeRequest('raapp_create', { type: 'html', content: '<p/>' }),
      ) as Record<string, unknown>;

      expect(result.mode).toBe('display');
      expect(raapp.execute).toHaveBeenCalledWith({ type: 'html', mode: 'display', content: '<p/>' });
    });
  });

  describe('negative scenarios', () => {
    it('returns error block when raapp.execute returns error status', async () => {
      (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'error',
        error: { code: 'PARSE_ERROR', message: 'Invalid HTML' },
      });

      const result = await tool.execute(
        makeRequest('raapp_create', { type: 'html', content: '<unclosed' }),
      ) as Record<string, unknown>;

      expect(result.status).toBe('error');
      expect(result.code).toBe('PARSE_ERROR');
      expect(result.message).toBe('Invalid HTML');
    });

    it('does not include renderedContent in error response', async () => {
      (raapp.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'error',
        error: { code: 'ERR', message: 'fail' },
      });

      const result = await tool.execute(
        makeRequest('raapp_create', { type: 'html', content: 'bad' }),
      ) as Record<string, unknown>;

      expect(result).not.toHaveProperty('renderedContent');
    });
  });
});

// ── RaAppCompileTool ──────────────────────────────────────────────────────────

describe('RaAppCompileTool', () => {
  let tool: RaAppCompileTool;
  let sandbox: Partial<RAAppSandboxService>;

  beforeEach(() => {
    sandbox = {
      execute: vi.fn(),
    };
    tool = new RaAppCompileTool(sandbox as RAAppSandboxService);
  });

  describe('positive scenarios', () => {
    it('returns { status: "ok", output } when sandbox succeeds', async () => {
      (sandbox.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ result: 42 });

      const result = await tool.execute(
        makeRequest('raapp_compile', { code: 'return { result: 42 }' }),
      ) as Record<string, unknown>;

      expect(result.status).toBe('ok');
      expect(result.output).toEqual({ result: 42 });
    });

    it('passes code to sandbox.execute', async () => {
      (sandbox.execute as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const code = 'const x = 1; return x;';
      await tool.execute(makeRequest('raapp_compile', { code }));

      expect(sandbox.execute).toHaveBeenCalledWith(code);
    });
  });

  describe('edge cases', () => {
    it('handles empty output from sandbox', async () => {
      (sandbox.execute as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await tool.execute(
        makeRequest('raapp_compile', { code: '// empty' }),
      ) as Record<string, unknown>;

      expect(result.status).toBe('ok');
      expect(result.output).toBeNull();
    });
  });

  describe('negative scenarios', () => {
    it('returns { status: "error", message } when sandbox throws Error', async () => {
      (sandbox.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('SyntaxError: Unexpected token'),
      );

      const result = await tool.execute(
        makeRequest('raapp_compile', { code: 'invalid !@#' }),
      ) as Record<string, unknown>;

      expect(result.status).toBe('error');
      expect(result.message).toBe('SyntaxError: Unexpected token');
    });

    it('returns "Unknown sandbox error" when sandbox throws non-Error', async () => {
      (sandbox.execute as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

      const result = await tool.execute(
        makeRequest('raapp_compile', { code: 'bad code' }),
      ) as Record<string, unknown>;

      expect(result.status).toBe('error');
      expect(result.message).toBe('Unknown sandbox error');
    });

    it('does not propagate (returns error object, not throws)', async () => {
      (sandbox.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

      await expect(tool.execute(makeRequest('raapp_compile', { code: '' }))).resolves.toMatchObject({
        status: 'error',
      });
    });
  });
});
