import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cleanup: vi.fn(), suppress: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn,
}));
vi.mock('./devin-cli-config', () => ({ createDevinCliConfig: async () => ({
  cwd: 'private', path: 'private/config', cleanup: mocks.cleanup, suppressMcpServers: vi.fn(),
}) }));
vi.mock('./devin-cli-mcp-catalog', () => ({ suppressInheritedDevinMcp: mocks.suppress }));
vi.mock('./devin-cli-model-catalog.service', async (original) => ({
  ...await original<typeof import('./devin-cli-model-catalog.service')>(), resolveDevinCliPath: () => 'devin.exe',
}));
import { DevinAcpHost } from './devin-cli-acp.host';

beforeEach(() => { vi.clearAllMocks(); mocks.cleanup.mockResolvedValue(undefined); });
describe('ACP startup configuration guard', () => {
  it('cleans the private config and never starts ACP when catalog verification fails', async () => {
    mocks.suppress.mockRejectedValue(new Error('Configuration check failed; host startup blocked.'));
    const host = new DevinAcpHost('swe-2');
    await expect(host.ensureSession('E:/Projekty/home-site')).rejects.toThrow('host startup blocked');
    expect(host.getStatus().status).toBe('error');
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).not.toHaveBeenCalled();
    await host.close();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });

  it('fences concurrent reset during preparation without spawning ACP', async () => {
    let finish!: (count: number) => void;
    mocks.suppress.mockImplementation(() => new Promise<number>(resolve => { finish = resolve; }));
    const host = new DevinAcpHost('swe-2');
    const starting = host.ensureSession('E:/Projekty/home-site');
    const rejected = expect(starting).rejects.toThrow('closed during startup');
    await vi.waitFor(() => expect(mocks.suppress).toHaveBeenCalledTimes(1));
    const closing = host.close();
    finish(16);
    await rejected;
    await closing;
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(host.getStatus().status).toBe('offline');
  });
});
