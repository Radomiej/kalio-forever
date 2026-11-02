import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DevinCliCommandQueueService } from './devin-cli-command-queue.service';
import { DevinCliModelCatalogService, parseDevinCliModelCatalog } from './devin-cli-model-catalog.service';
import { readDevinAcpModelCatalog } from './devin-cli-acp.model-catalog';

vi.mock('./devin-cli-acp.model-catalog', () => ({ readDevinAcpModelCatalog: vi.fn() }));

describe('ACP-authoritative model catalog', () => {
  it('does not advertise CLI-only Medium/Max variants or invent models from sidekick names', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: [
      '  swe-2-high    SWE-2 High', '  swe-2-medium    SWE-2 Medium', '  swe-2-max    SWE-2 Max',
    ].join('\n'), stderr: '' });
    vi.mocked(readDevinAcpModelCatalog).mockResolvedValueOnce([
      'glm-5-2', 'swe-2-high', 'fusion-gpt-6-sol-high-sidekick-swe-2-medium',
    ]);
    const service = new DevinCliModelCatalogService({ run } as unknown as DevinCliCommandQueueService);
    const catalog = await service.getCatalog('devin.exe', true);
    expect(catalog).toMatchObject({ status: 'ready', stale: false, models: [
      'glm-5-2', 'swe-2-high', 'fusion-gpt-6-sol-high-sidekick-swe-2-medium',
    ] });
    expect(readDevinAcpModelCatalog).toHaveBeenCalledWith('devin.exe', 'swe-2-high');
    catalog.models.push('swe-2-medium');
    expect((await service.getCatalog('devin.exe')).models).not.toContain('swe-2-medium');
    expect(run).toHaveBeenCalledOnce();
  });

  it('fails closed when CLI rows exist but ACP metadata cannot be obtained', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '  swe-2-medium    SWE-2 Medium', stderr: '' });
    vi.mocked(readDevinAcpModelCatalog).mockRejectedValueOnce(new Error('fixture metadata failure'));
    const service = new DevinCliModelCatalogService({ run } as unknown as DevinCliCommandQueueService);
    await expect(service.getCatalog('devin.exe', true)).resolves.toMatchObject({
      status: 'command-failed', models: [], stale: false,
    });
  });
});

describe('model catalog failure diagnostics', () => {
  it.each([
    [{ code: 'ENOENT' }, 'code=ENOENT signal=none killed=false'],
    [{ code: null, signal: 'SIGTERM', killed: true }, 'code=unknown signal=SIGTERM killed=true'],
    [{ code: 7 }, 'code=7 signal=none killed=false'],
    [{ code: 'secret-value', signal: 'private-value' }, 'code=unknown signal=unknown killed=false'],
  ])('logs safe failure metadata without command output: %j', async (metadata, expected) => {
    const queue = new DevinCliCommandQueueService();
    const run = vi.spyOn(queue, 'run').mockRejectedValue({
      ...metadata, message: 'SECRET_MESSAGE', stdout: 'SECRET_STDOUT', stderr: 'SECRET_STDERR',
    });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const service = new DevinCliModelCatalogService(queue);
      await expect(service.getCatalog('devin.exe', true)).resolves.toMatchObject({ status: 'command-failed' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(expected));
      expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      run.mockRestore();
      warn.mockRestore();
    }
  });
});

describe('parseDevinCliModelCatalog', () => {
  it('returns only concrete row IDs, excluding family slugs and aliases', () => {
    const output = [
      '\u001b[1mAvailable models (2 families)\u001b[0m',
      'GLM-5.2 (glm-5.2)',
      '  glm-5-2                                                                  GLM-5.2 High [Free]',
      'SWE-2 (swe-2)',
      '  aliases: swe',
      '  swe-2-high                                                              SWE-2 High [Free]',
      '  swe-2-medium                                                            SWE-2 Medium [Free]',
      '  swe-2-max                                                               SWE-2 Max [Free]',
      'Fusion (fusion-gpt-6-sol-high-sidekick-swe-2-medium)',
      '  fusion-gpt-6-sol-high-sidekick-swe-2-medium                             Fusion (GPT-6 Sol + SWE-2 Medium)',
      'malformed model line with spaces',
    ].join('\r\n');

    expect(parseDevinCliModelCatalog(output)).toEqual([
      'glm-5-2', 'swe-2-high', 'swe-2-medium', 'swe-2-max',
      'fusion-gpt-6-sol-high-sidekick-swe-2-medium',
    ]);
  });
  it('does not advertise a family-only catalog as ready or invent its variant', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'SWE-2 (swe-2)\n  aliases: swe', stderr: '' });
    const service = new DevinCliModelCatalogService({ run } as unknown as DevinCliCommandQueueService);
    await expect(service.getCatalog('devin.exe', true)).resolves.toMatchObject({
      models: [], status: 'unrecognized-output', stale: false,
    });
  });

  it('rejects control characters and returns no identifiers for unrecognized output', () => {
    expect(parseDevinCliModelCatalog('  bad\u0000model  description\nno model entries')).toEqual([]);
  });
});
