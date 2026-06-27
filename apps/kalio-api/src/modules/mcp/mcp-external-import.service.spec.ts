import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateMCPServerDto, MCPServer } from '@kalio/types';
import { MCPExternalImportService } from './mcp-external-import.service';
import type { MCPService } from './mcp.service';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));

import { access, readFile } from 'node:fs/promises';

const accessMock = vi.mocked(access);
const readFileMock = vi.mocked(readFile);

describe('MCPExternalImportService', () => {
  const existingServer: MCPServer = {
    id: 'existing-1',
    serverKey: 'sqlite::existing-1',
    name: 'Existing GitHub',
    store: 'sqlite',
    originSource: 'manual',
    effectiveState: 'active',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    status: 'connected',
    toolCount: 1,
    createdAt: Date.now(),
  };

  const mcpService = {
    findAll: vi.fn(async () => [existingServer]),
    addServer: vi.fn(async (dto: CreateMCPServerDto) => ({
      id: `new-${dto.name}`,
      serverKey: `sqlite::new-${dto.name}`,
      name: dto.name,
      store: 'sqlite',
      originSource: dto.originSource ?? 'manual',
      effectiveState: 'active',
      transport: dto.transport,
      command: dto.command,
      url: dto.url,
      args: dto.args,
      status: 'connecting',
      toolCount: 0,
      createdAt: Date.now(),
    } satisfies MCPServer)),
  };

  let service: MCPExternalImportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MCPExternalImportService(mcpService as unknown as MCPService);

    accessMock.mockImplementation(async (path) => {
      const normalized = String(path).toLowerCase();
      if (normalized.includes('.cursor') && normalized.endsWith('mcp.json')) {
        return undefined;
      }
      throw new Error('ENOENT');
    });

    readFileMock.mockImplementation(async (path) => {
      const normalized = String(path).toLowerCase();
      if (normalized.includes('.cursor') && normalized.endsWith('mcp.json')) {
        return JSON.stringify({
          mcpServers: {
            github: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              env: {
                GITHUB_TOKEN: '${GITHUB_TOKEN}',
              },
            },
            filesystem: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
            },
          },
        });
      }
      throw new Error('ENOENT');
    });
  });

  it('discovers entries from external configs and marks equivalent existing configs by signature', async () => {
    const entries = await service.discover();

    expect(entries).toHaveLength(2);
    const github = entries.find((entry) => entry.sourceKey === 'github');
    const filesystem = entries.find((entry) => entry.sourceKey === 'filesystem');

    expect(github?.equivalentToExisting).toBe(true);
    expect(github?.details.envKeys).toEqual(['GITHUB_TOKEN']);
    expect(filesystem?.equivalentToExisting).toBe(false);
    expect(filesystem?.dto.transport).toBe('stdio');
  });

  it('parses external MCP configs with a UTF-8 BOM', async () => {
    readFileMock.mockImplementation(async (path) => {
      const normalized = String(path).toLowerCase();
      if (normalized.includes('.cursor') && normalized.endsWith('mcp.json')) {
        return `\uFEFF${JSON.stringify({
          servers: {
            bomServer: {
              command: 'node',
              args: ['server.js'],
            },
          },
        })}`;
      }
      throw new Error('ENOENT');
    });

    const entries = await service.discover();

    expect(entries.map((entry) => entry.sourceKey)).toEqual(['bomServer']);
  });

  it('applies selected entries even when equivalent config already exists and reports fail buckets', async () => {
    mcpService.addServer.mockRejectedValueOnce(new Error('connect failed'));

    const discovered = await service.discover();
    const githubId = discovered.find((entry) => entry.sourceKey === 'github')?.id;
    const filesystemId = discovered.find((entry) => entry.sourceKey === 'filesystem')?.id;
    expect(githubId).toBeDefined();
    expect(filesystemId).toBeDefined();
    const selectedGithubId = githubId as string;
    const selectedFilesystemId = filesystemId as string;

    const result = await service.apply([selectedGithubId, selectedFilesystemId, 'missing-id']);

    expect(result.imported).toEqual([
      expect.objectContaining({
        name: 'filesystem',
        originSource: 'cursor',
      }),
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([
      { id: selectedGithubId, reason: 'connect failed' },
      { id: 'missing-id', reason: 'Entry was not found in current discovery snapshot' },
    ]);
  });

  it('keeps duplicate signatures within the same discovery scan selectable and imports both', async () => {
    accessMock.mockImplementation(async (path) => {
      const normalized = String(path).toLowerCase();
      if (normalized.includes('.cursor') || normalized.includes('code\\user') || normalized.includes('code/user')) {
        return undefined;
      }
      throw new Error('ENOENT');
    });
    readFileMock.mockImplementation(async (path) => {
      const normalized = String(path).toLowerCase();
      if (normalized.includes('.cursor')) {
        return JSON.stringify({
          mcpServers: {
            localTools: {
              command: 'node',
              args: ['C:\\tools\\mcp.js', 'stdio'],
            },
          },
        });
      }
      if (normalized.includes('code\\user') || normalized.includes('code/user')) {
        return JSON.stringify({
          servers: {
            localToolsAgain: {
              type: 'stdio',
              command: 'node',
              args: ['C:\\tools\\mcp.js', 'stdio'],
            },
          },
        });
      }
      throw new Error('ENOENT');
    });

    const entries = await service.discover();

    expect(entries.map((entry) => ({ sourceKey: entry.sourceKey, equivalentToExisting: entry.equivalentToExisting }))).toEqual([
      { sourceKey: 'localTools', equivalentToExisting: false },
      { sourceKey: 'localToolsAgain', equivalentToExisting: false },
    ]);

    const result = await service.apply(entries.map((entry) => entry.id));

    expect(result.imported).toHaveLength(2);
    expect(result.imported.map((entry) => entry.name)).toEqual(['localTools', 'localToolsAgain']);
    expect(result.skipped).toEqual([]);
  });

  it('discovers workspace VS Code MCP configs for the Kalio Settings import flow', async () => {
    const mockedCwd = process.platform === 'win32'
      ? 'C:\\Projekty\\kalio-forever\\apps\\kalio-api'
      : '/workspace/kalio-forever/apps/kalio-api';
    const workspaceConfig = process.platform === 'win32'
      ? 'c:/projekty/kalio-forever/.vscode/mcp.json'
      : '/workspace/kalio-forever/.vscode/mcp.json';
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(mockedCwd);

    accessMock.mockImplementation(async (path) => {
      const normalized = String(path).toLowerCase().replaceAll('\\', '/');
      if (normalized === workspaceConfig) {
        return undefined;
      }
      throw new Error('ENOENT');
    });
    readFileMock.mockImplementation(async (path) => {
      const normalized = String(path).toLowerCase().replaceAll('\\', '/');
      if (normalized === workspaceConfig) {
        return JSON.stringify({
          servers: {
            'mcp-dev-servers': {
              type: 'stdio',
              command: 'node',
              args: ['C:\\Projekty\\mcp-dev-servers\\dist\\index.js', 'stdio'],
              env: {
                DEV_SERVERS_BACKEND_URL: 'http://127.0.0.1:3418',
                DEV_SERVERS_API_TOKEN: 'change-me-local-token',
              },
            },
            'mcp-playwright-orchestrator': {
              type: 'stdio',
              command: 'node',
              args: ['C:\\Projekty\\mcp-playwrigh-master\\dist\\index.js', '--mode', 'stdio'],
            },
          },
        });
      }
      throw new Error('ENOENT');
    });

    const entries = await service.discover();

    expect(entries.map((entry) => entry.sourceKey)).toEqual([
      'mcp-dev-servers',
      'mcp-playwright-orchestrator',
    ]);
    expect(entries.every((entry) => entry.source === 'copilot')).toBe(true);
    expect(entries[0]?.dto).toMatchObject({
      name: 'mcp-dev-servers',
      transport: 'stdio',
      command: 'node',
    });
    expect(entries[0]?.details.envKeys).toEqual([
      'DEV_SERVERS_BACKEND_URL',
      'DEV_SERVERS_API_TOKEN',
    ]);
    cwdSpy.mockRestore();
  });
});
