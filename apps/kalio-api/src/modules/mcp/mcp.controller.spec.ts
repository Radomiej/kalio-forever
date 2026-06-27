import type { CreateMCPServerDto } from '@kalio/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPController } from './mcp.controller';
import { MCPService } from './mcp.service';
import { MCPExternalImportService } from './mcp-external-import.service';

describe('MCPController', () => {
  const serverDto: CreateMCPServerDto = {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
  };
  const servers = [{ id: 'server-1', name: 'filesystem' }];
  const tools = [{ serverId: 'server-1', name: 'read_file', description: 'Read files' }];
  const externalEntries = [{
    id: 'cursor:mcp:github',
    source: 'cursor',
    configPath: 'C:/Users/test/.cursor/mcp.json',
    key: 'github',
    dto: {
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    },
    details: { envKeys: ['GITHUB_TOKEN'], headerKeys: [] },
    equivalentToExisting: false,
  }];
  const mcpService = {
    findAll: vi.fn(async () => servers),
    addServer: vi.fn(async (_dto: CreateMCPServerDto) => undefined),
    reloadManagedServers: vi.fn(async () => servers),
    removeServer: vi.fn(async (_id: string) => undefined),
    restartServer: vi.fn(async (_id: string) => undefined),
    getAllTools: vi.fn(async () => tools),
  };
  const externalImportService = {
    discover: vi.fn(async () => externalEntries),
    apply: vi.fn(async (_entryIds: string[]) => ({
      imported: [{ id: 'server-2', name: 'github' }],
      skipped: [],
      failed: [],
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates listing servers to the service', async () => {
    const controller = new MCPController(
      mcpService as unknown as MCPService,
      externalImportService as unknown as MCPExternalImportService,
    );

    await expect(controller.findAll()).resolves.toStrictEqual(servers);
    expect(mcpService.findAll).toHaveBeenCalledOnce();
  });

  it('delegates server creation to the service', async () => {
    const controller = new MCPController(
      mcpService as unknown as MCPService,
      externalImportService as unknown as MCPExternalImportService,
    );

    await expect(controller.addServer(serverDto)).resolves.toBeUndefined();
    expect(mcpService.addServer).toHaveBeenCalledWith(serverDto);
  });

  it('delegates server removal to the service', async () => {
    const controller = new MCPController(
      mcpService as unknown as MCPService,
      externalImportService as unknown as MCPExternalImportService,
    );

    await expect(controller.removeServer('sqlite::server-1')).resolves.toBeUndefined();
    expect(mcpService.removeServer).toHaveBeenCalledWith('sqlite::server-1');
  });

  it('delegates config reload to the service', async () => {
    const controller = new MCPController(
      mcpService as unknown as MCPService,
      externalImportService as unknown as MCPExternalImportService,
    );

    await expect(controller.reloadConfig()).resolves.toStrictEqual(servers);
    expect(mcpService.reloadManagedServers).toHaveBeenCalledOnce();
  });

  it('delegates server restart to the service', async () => {
    const controller = new MCPController(
      mcpService as unknown as MCPService,
      externalImportService as unknown as MCPExternalImportService,
    );

    await expect(controller.restartServer('sqlite::server-1')).resolves.toBeUndefined();
    expect(mcpService.restartServer).toHaveBeenCalledWith('sqlite::server-1');
  });

  it('accepts legacy serverId input and forwards it unchanged for compatibility', async () => {
    const legacyId = 'github';
    const controller = new MCPController(
      mcpService as unknown as MCPService,
      externalImportService as unknown as MCPExternalImportService,
    );

    await expect(controller.removeServer(legacyId)).resolves.toBeUndefined();
    expect(mcpService.removeServer).toHaveBeenCalledWith(legacyId);
  });

  it('accepts legacy serverId input for restart and forwards it unchanged for compatibility', async () => {
    const legacyId = 'github';
    const controller = new MCPController(
      mcpService as unknown as MCPService,
      externalImportService as unknown as MCPExternalImportService,
    );

    await expect(controller.restartServer(legacyId)).resolves.toBeUndefined();
    expect(mcpService.restartServer).toHaveBeenCalledWith(legacyId);
  });

  it('delegates tool listing to the service', async () => {
    const controller = new MCPController(
      mcpService as unknown as MCPService,
      externalImportService as unknown as MCPExternalImportService,
    );

    await expect(controller.getTools()).resolves.toStrictEqual(tools);
    expect(mcpService.getAllTools).toHaveBeenCalledOnce();
  });

  it('delegates external MCP discovery to the service', async () => {
    const controller = new MCPController(
      mcpService as unknown as MCPService,
      externalImportService as unknown as MCPExternalImportService,
    );

    await expect(controller.discoverExternalConfigs()).resolves.toStrictEqual(externalEntries);
    expect(externalImportService.discover).toHaveBeenCalledOnce();
  });

  it('delegates external MCP import apply to the service', async () => {
    const controller = new MCPController(
      mcpService as unknown as MCPService,
      externalImportService as unknown as MCPExternalImportService,
    );

    await expect(controller.applyExternalConfigs({ entryIds: ['cursor:mcp:github'] })).resolves.toStrictEqual({
      imported: [{ id: 'server-2', name: 'github' }],
      skipped: [],
      failed: [],
    });
    expect(externalImportService.apply).toHaveBeenCalledWith(['cursor:mcp:github']);
  });
});
