import { describe, it, expect, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RAAppSandboxService } from './raapp-sandbox.service';

describe('RAAppSandboxService', () => {
  let service: RAAppSandboxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RAAppSandboxService],
    }).compile();
    service = module.get(RAAppSandboxService);
  });

  it('executes simple return expression', async () => {
    const result = await service.execute('return 42;');
    expect(result).toBe('42');
  });

  it('executes string concatenation', async () => {
    const result = await service.execute('return "hello" + " " + "world";');
    expect(result).toBe('hello world');
  });

  it('executes code with variables', async () => {
    const result = await service.execute('const x = 5; const y = 3; return x * y;');
    expect(result).toBe('15');
  });

  it('returns empty string when nothing is returned', async () => {
    const result = await service.execute('const x = 1;');
    expect(result).toBe('');
  });

  it('throws for infinite loops (timeout)', async () => {
    await expect(service.execute('while(true){}')).rejects.toThrow();
  });

  it('throws for syntax errors', async () => {
    await expect(service.execute('return ((( invalid;;;')).rejects.toThrow();
  });

  it('cannot access Node.js globals (process)', async () => {
    await expect(service.execute('return process.env.HOME;')).rejects.toThrow();
  });

  it('returns string coercion of numeric result', async () => {
    const result = await service.execute('return 3.14;');
    expect(result).toBe('3.14');
  });
});
