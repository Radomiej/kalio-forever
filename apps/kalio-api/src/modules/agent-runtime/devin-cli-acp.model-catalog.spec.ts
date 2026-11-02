import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { readDevinAcpModelCatalog } from './devin-cli-acp.model-catalog';

const fixture = vi.hoisted(() => ({
  configOptions: [] as unknown[],
  children: [] as ChildProcessWithoutNullStreams[],
  cleanup: vi.fn(async () => undefined),
  suppress: vi.fn(async () => 0),
}));

vi.mock('./devin-cli-config', () => ({
  createDevinCliConfig: vi.fn(async (_model, _servers, _policy, allocated) => {
    const handle = { cwd: process.cwd(), cleanup: fixture.cleanup };
    allocated(handle);
    return handle;
  }),
}));
vi.mock('./devin-cli-mcp-catalog', () => ({ suppressInheritedDevinMcp: fixture.suppress }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn((_executable, args, options) => {
    expect(args).toEqual(['acp']);
    expect(fixture.suppress).toHaveBeenCalled();
    // Real stdio/SDK framing, request order and process teardown; no provider prompt.
    const script = `
      const configOptions = ${JSON.stringify(fixture.configOptions)};
      let initialized = false;
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        const request = JSON.parse(line);
        let result;
        if (request.method === 'initialize') {
          initialized = true;
          result = { protocolVersion: 1, agentCapabilities: {} };
        } else if (request.method === 'session/new' && initialized && request.params.mcpServers.length === 0) {
          result = { sessionId: 'catalog-fixture', configOptions };
        } else { process.exit(9); }
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
      });
    `;
    const child = actual.spawn(process.execPath, ['-e', script], options) as ChildProcessWithoutNullStreams;
    fixture.children.push(child);
    return child;
  }) };
});

afterEach(() => {
  for (const child of fixture.children) {
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  }
  fixture.children.length = 0;
  vi.clearAllMocks();
});

describe('Devin ACP catalog metadata transport', () => {
  it('reads actual model options over SDK stdio and closes the isolated child without prompting', async () => {
    fixture.configOptions = [{
      id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'glm-5-2', options: [
        { value: 'glm-5-2', name: 'GLM' }, { value: 'swe-2-high', name: 'SWE-2' },
        { value: 'fusion-sidekick-swe-2-medium', name: 'Fusion Medium' },
      ],
    }];
    await expect(readDevinAcpModelCatalog('devin.exe', 'swe-2-medium')).resolves.toEqual([
      'glm-5-2', 'swe-2-high', 'fusion-sidekick-swe-2-medium',
    ]);
    expect(fixture.cleanup).toHaveBeenCalledOnce();
  });

  it('rejects sessions without a model selector and still closes the process and overlay', async () => {
    fixture.configOptions = [{
      id: 'reasoning', name: 'Reasoning', type: 'select', currentValue: 'medium',
      options: [{ value: 'medium', name: 'Medium' }],
    }];
    await expect(readDevinAcpModelCatalog('devin.exe', 'swe-2-medium')).rejects.toThrow('metadata is missing');
    expect(fixture.cleanup).toHaveBeenCalledOnce();
  });
});
