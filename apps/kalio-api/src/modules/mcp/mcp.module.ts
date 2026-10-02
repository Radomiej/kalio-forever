import { Module } from '@nestjs/common';
import { MCPService } from './mcp.service';
import { MCPController } from './mcp.controller';
import { KalioConfigModule } from '../../config/kalio-config.module';
import { MCPExternalImportService } from './mcp-external-import.service';
import { AuditModule } from '../chat/audit.module';

@Module({
  imports: [KalioConfigModule, AuditModule],
  controllers: [MCPController],
  providers: [MCPService, MCPExternalImportService],
  exports: [MCPService],
})
export class MCPModule {}
