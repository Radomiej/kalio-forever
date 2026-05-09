import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { MCPService } from './mcp.service';
import type { CreateMCPServerDto } from '@kalio/types';

@Controller('mcp')
export class MCPController {
  constructor(private readonly mcpService: MCPService) {}

  @Get('servers')
  findAll() {
    return this.mcpService.findAll();
  }

  @Post('servers')
  addServer(@Body() dto: CreateMCPServerDto) {
    return this.mcpService.addServer(dto);
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
