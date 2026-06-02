import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { MCPService } from './mcp.service';
import type { CreateMCPServerDto } from '@kalio/types';
import { MCPExternalImportService } from './mcp-external-import.service';

interface ApplyExternalConfigsDto {
  entryIds?: string[];
}

@Controller('mcp')
export class MCPController {
  constructor(
    private readonly mcpService: MCPService,
    private readonly externalImportService: MCPExternalImportService,
  ) {}

  @Get('servers')
  findAll() {
    return this.mcpService.findAll();
  }

  @Post('servers')
  addServer(@Body() dto: CreateMCPServerDto) {
    return this.mcpService.addServer(dto);
  }

  @Post('servers/reload-config')
  reloadConfig() {
    return this.mcpService.reloadManagedServers();
  }

  @Post('servers/import/external/discover')
  discoverExternalConfigs() {
    return this.externalImportService.discover();
  }

  @Post('servers/import/external/apply')
  applyExternalConfigs(@Body() dto: ApplyExternalConfigsDto) {
    return this.externalImportService.apply(Array.isArray(dto.entryIds) ? dto.entryIds : []);
  }

  @Delete('servers/:id')
  removeServer(@Param('id') id: string) {
    return this.mcpService.removeServer(id);
  }

  @Post('servers/:id/restart')
  restartServer(@Param('id') id: string) {
    return this.mcpService.restartServer(id);
  }

  @Get('tools')
  getTools() {
    return this.mcpService.getAllTools();
  }
}
