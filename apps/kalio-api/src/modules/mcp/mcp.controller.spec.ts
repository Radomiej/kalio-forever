import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { MCPController } from './mcp.controller';
import { MCPService } from './mcp.service';
import type { MCPServer, MCPTool, CreateMCPServerDto } from '@kalio/types';

describe('MCPController', () => {
  let controller: MCPController;
  const mockService = {
    findAll: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    restartServer: vi.fn(),
    getAllTools: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MCPController],
      providers: [{ provide: MCPService, useValue: mockService }],
    }).compile();

    controller = module.get(MCPController);
    vi.clearAllMocks();
  });

  describe('findAll()', () => {
    it('delegates to mcpService.findAll()', async () => {
      const servers: MCPServer[] = [
        { id: 's1', name: 'Server 1', transport: 'http', status: 'connected', toolCount: 2, createdAt: 1000 },
      ];
      mockService.findAll.mockResolvedValue(servers);

      const result = await controller.findAll();
      expect(result).toBe(servers);
      expect(mockService.findAll).toHaveBeenCalled();
    });
  });

  describe('addServer()', () => {
    it('delegates to mcpService.addServer() with dto', async () => {
      const dto: CreateMCPServerDto = { name: 'New Server', transport: 'http', url: 'http://localhost:3000' };
      const server: MCPServer = { id: 'new-s', name: 'New Server', transport: 'http', status: 'connecting', toolCount: 0, createdAt: 2000 };
      mockService.addServer.mockResolvedValue(server);

      const result = await controller.addServer(dto);
      expect(result).toBe(server);
      expect(mockService.addServer).toHaveBeenCalledWith(dto);
    });
  });

  describe('removeServer()', () => {
    it('delegates to mcpService.removeServer() with id', async () => {
      mockService.removeServer.mockResolvedValue(undefined);
      await controller.removeServer('s-123');
      expect(mockService.removeServer).toHaveBeenCalledWith('s-123');
    });
  });

  describe('restartServer()', () => {
    it('delegates to mcpService.restartServer() with id', async () => {
      mockService.restartServer.mockResolvedValue(undefined);
      await controller.restartServer('s-456');
      expect(mockService.restartServer).toHaveBeenCalledWith('s-456');
    });
  });

  describe('getTools()', () => {
    it('delegates to mcpService.getAllTools()', () => {
      const tools: MCPTool[] = [
        { name: 'mcp_s1_search', description: 'search', parameters: {}, requiresConfirmation: false, serverId: 's1' },
      ];
      mockService.getAllTools.mockReturnValue(tools);

      const result = controller.getTools();
      expect(result).toBe(tools);
      expect(mockService.getAllTools).toHaveBeenCalled();
    });

    it('returns empty array when no tools', () => {
      mockService.getAllTools.mockReturnValue([]);
      expect(controller.getTools()).toHaveLength(0);
    });
  });
});
