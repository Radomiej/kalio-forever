import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AllowedPathsModule } from '../allowed-paths/allowed-paths.module';
import { AuditModule } from '../chat/audit.module';
import { CodeIntelligenceController } from './code-intelligence.controller';
import { CodeIntelligenceService } from './code-intelligence.service';
import { ProjectIdeRuntimeManager } from './project-ide-runtime.manager';
import { VsCodeBridgeBackend } from './vscode-bridge.backend';

@Module({
  imports: [DatabaseModule, AllowedPathsModule, AuditModule],
  controllers: [CodeIntelligenceController],
  providers: [VsCodeBridgeBackend, ProjectIdeRuntimeManager, CodeIntelligenceService],
  exports: [VsCodeBridgeBackend, ProjectIdeRuntimeManager, CodeIntelligenceService],
})
export class CodeIntelligenceModule {}
