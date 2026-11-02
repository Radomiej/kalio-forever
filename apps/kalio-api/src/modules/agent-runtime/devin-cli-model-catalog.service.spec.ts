import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevinCliCommandQueueService } from './devin-cli-command-queue.service';
import { DevinCliModelCatalogService } from './devin-cli-model-catalog.service';
import { readDevinAcpModelCatalog } from './devin-cli-acp.model-catalog';

vi.mock('./devin-cli-acp.model-catalog', () => ({ readDevinAcpModelCatalog: vi.fn() }));

const actualModelValues = ['glm-5-2', 'swe-2-high', 'fusion-gpt-6-sol-high-sidekick-swe-2-medium'];
const createService = () => new DevinCliModelCatalogService();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readDevinAcpModelCatalog).mockResolvedValue([...actualModelValues]);
  vi.spyOn(DevinCliCommandQueueService.prototype, 'run').mockResolvedValue({
    stdout: '  swe-2-high    SWE-2 High\n  swe-2-medium    SWE-2 Medium', stderr: '',
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('ACP-primary model catalog', () => {
  it('is ready from ACP metadata even when CLI models-list would time out, without calling it', async () => {
    const run = vi.mocked(DevinCliCommandQueueService.prototype.run).mockRejectedValue({ signal: 'SIGTERM', killed: true });
    const service = createService();
    expect(await service.getCatalog('devin.exe', true)).toMatchObject({ status: 'ready', stale: false, models: actualModelValues });
    expect(run).not.toHaveBeenCalled();
    expect(readDevinAcpModelCatalog).toHaveBeenCalledExactlyOnceWith('devin.exe');
  });
  it('returns only actual ACP selector values and keeps cached arrays private', async () => {
    const service = createService();
    const catalog = await service.getCatalog('devin.exe');
    expect(catalog.models).toEqual(actualModelValues);
    expect(catalog.models).not.toContain('swe-2-medium');
    catalog.models.push('injected-model');
    expect((await service.getCatalog('devin.exe')).models).toEqual(actualModelValues);
    expect(readDevinAcpModelCatalog).toHaveBeenCalledTimes(1);
  });
  it('deduplicates concurrent discovery for the same executable', async () => {
    let finish!: (models: string[]) => void;
    vi.mocked(readDevinAcpModelCatalog).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const service = createService();
    const first = service.getCatalog('devin.exe', true);
    const second = service.getCatalog('devin.exe', true);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(readDevinAcpModelCatalog).toHaveBeenCalledTimes(1);
    finish([...actualModelValues]);
    expect((await first).models).toEqual(actualModelValues);
    expect((await second).models).toEqual(actualModelValues);
  });
  it('refreshes after TTL and on explicit refresh without inventing fallback models', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000);
    const service = createService();
    await service.getCatalog('devin.exe');
    vi.setSystemTime(129999); await service.getCatalog('devin.exe');
    expect(readDevinAcpModelCatalog).toHaveBeenCalledTimes(1);
    vi.setSystemTime(130000); await service.getCatalog('devin.exe');
    expect(readDevinAcpModelCatalog).toHaveBeenCalledTimes(2);
    await service.getCatalog('devin.exe', true);
    expect(readDevinAcpModelCatalog).toHaveBeenCalledTimes(3);
  });
  it('marks prior metadata stale on failed refresh and recovers on later metadata success', async () => {
    const service = createService();
    await service.getCatalog('devin.exe');
    vi.mocked(readDevinAcpModelCatalog).mockRejectedValueOnce(new Error('fixture metadata failure'));
    expect(await service.getCatalog('devin.exe', true)).toMatchObject({ status: 'command-failed', stale: true, models: actualModelValues });
    expect(await service.getCatalog('devin.exe', true)).toMatchObject({ status: 'ready', stale: false });
  });
  it('never reuses a different executable catalog and rejects empty ACP metadata', async () => {
    const service = createService();
    await service.getCatalog('first.exe');
    vi.mocked(readDevinAcpModelCatalog).mockResolvedValueOnce([]);
    expect(await service.getCatalog('second.exe')).toMatchObject({ status: 'unrecognized-output', stale: false, models: [] });
  });
});

describe('catalog failure diagnostics', () => {
  it.each([
    [{ code: 'ENOENT' }, 'code=ENOENT signal=none killed=false'],
    [{ code: null, signal: 'SIGTERM', killed: true }, 'code=unknown signal=SIGTERM killed=true'],
    [{ code: 7 }, 'code=7 signal=none killed=false'],
    [{ code: 'secret-value', signal: 'private-value' }, 'code=unknown signal=unknown killed=false'],
  ])('logs safe metadata without output bodies: %j', async (metadata, expected) => {
    vi.mocked(readDevinAcpModelCatalog).mockRejectedValueOnce({ ...metadata,
      message: 'SECRET_MESSAGE', stdout: 'SECRET_STDOUT', stderr: 'SECRET_STDERR',
    });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(createService().getCatalog('devin.exe', true)).resolves.toMatchObject({ status: 'command-failed', models: [] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(expected));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
  });
});
