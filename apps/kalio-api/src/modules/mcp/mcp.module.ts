import { Module } from '@nestjs/common';
import { MCPService } from './mcp.service';
import { MCPController } from './mcp.controller';

@Module({
  controllers: [MCPController],
  providers: [MCPService],
  exports: [MCPService],
})
export class MCPModule {}
