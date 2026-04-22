import { describe, it, expect, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RAAppService } from './raapp.service';
import { RAAppSandboxService } from './raapp-sandbox.service';

// AC-13: RA-App DSL parse error is returned inline (not thrown), with code DSL_PARSE_ERROR

describe('RAAppService', () => {
  let service: RAAppService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [RAAppService, RAAppSandboxService],
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

  describe('execute — DSL sandbox errors returned inline', () => {
    it('returns DSL_EXEC_ERROR when sandbox throws', async () => {
      const result = await service.execute({ type: 'gui', mode: 'display', content: 'throw new Error("test error")' });

      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('DSL_EXEC_ERROR');
    });

    it('does not throw when DSL execution fails', async () => {
      await expect(
        service.execute({ type: 'gui', mode: 'display', content: 'invalid javascript )(('}),
      ).resolves.toMatchObject({ status: 'error' });
    });
  });
});
