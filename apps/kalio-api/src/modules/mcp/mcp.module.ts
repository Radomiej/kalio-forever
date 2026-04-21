import { Module } from '@nestjs/common';
import { MCPService } from './mcp.service';
import { MCPWatchdogService } from './mcp-watchdog.service';

@Module({
  providers: [MCPService, MCPWatchdogService],
  exports: [MCPService],
})
export class MCPModule {}
