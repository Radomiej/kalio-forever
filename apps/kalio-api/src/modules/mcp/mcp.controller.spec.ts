import type { CreateMCPServerDto } from '@kalio/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPController } from './mcp.controller';
import { MCPService } from './mcp.service';

describe('MCPController', () => {
  const serverDto: CreateMCPServerDto = {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
  };
  const servers = [{ id: 'server-1', name: 'filesystem' }];
  const tools = [{ serverId: 'server-1', name: 'read_file', description: 'Read files' }];
  const mcpService = {
    findAll: vi.fn(async () => servers),
    addServer: vi.fn(async (_dto: CreateMCPServerDto) => undefined),
    removeServer: vi.fn(async (_id: string) => undefined),
    restartServer: vi.fn(async (_id: string) => undefined),
    getAllTools: vi.fn(async () => tools),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates listing servers to the service', async () => {
    const controller = new MCPController(mcpService as unknown as MCPService);

    await expect(controller.findAll()).resolves.toStrictEqual(servers);
    expect(mcpService.findAll).toHaveBeenCalledOnce();
  });

  it('delegates server creation to the service', async () => {
    const controller = new MCPController(mcpService as unknown as MCPService);

    await expect(controller.addServer(serverDto)).resolves.toBeUndefined();
    expect(mcpService.addServer).toHaveBeenCalledWith(serverDto);
  });

  it('delegates server removal to the service', async () => {
    const controller = new MCPController(mcpService as unknown as MCPService);

    await expect(controller.removeServer('server-1')).resolves.toBeUndefined();
    expect(mcpService.removeServer).toHaveBeenCalledWith('server-1');
  });

  it('delegates server restart to the service', async () => {
    const controller = new MCPController(mcpService as unknown as MCPService);

    await expect(controller.restartServer('server-1')).resolves.toBeUndefined();
    expect(mcpService.restartServer).toHaveBeenCalledWith('server-1');
  });

  it('delegates tool listing to the service', async () => {
    const controller = new MCPController(mcpService as unknown as MCPService);

    await expect(controller.getTools()).resolves.toStrictEqual(tools);
    expect(mcpService.getAllTools).toHaveBeenCalledOnce();
  });
});