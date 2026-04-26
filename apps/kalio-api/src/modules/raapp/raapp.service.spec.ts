import { describe, it, expect, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RAAppService } from './raapp.service';
import { RAAppSandboxService } from './raapp-sandbox.service';

// AC-13: RA-App DSL parse error is returned inline (not thrown), with code DSL_PARSE_ERROR

describe('RAAppService', () => {
  let service: RAAppService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RAAppService,
        RAAppSandboxService,
        { provide: ConfigService, useValue: { get: (_key: string, def: unknown) => def } },
      ],
    }).compile();

    service = moduleRef.get<RAAppService>(RAAppService);
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
});
