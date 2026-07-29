import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { CLIAgentModule } from '../cli-agent/cli-agent.module';
import { VFSModule } from '../vfs/vfs.module';
import { ArchitectureRegistryController } from './architecture-registry.controller';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { ARCHITECTURE_ROLE_EXECUTOR, ArchitectureRoleExecutorService } from './architecture-role-executor';
import { ArchitectureRunsController } from './architecture-runs.controller';
import { ArchitectureRuntimeService } from './architecture-runtime.service';
import { ArchitectureRunPreparationService } from './architecture-run-preparation.service';
import { ArchitectureRuntimeAuditWriterService } from './architecture-runtime-audit.service';
import { ARCHITECTURE_RUNTIME_STOP } from '../chat/architecture-runtime-stop.port';

@Module({
  imports: [ChatModule, VFSModule, CLIAgentModule],
  controllers: [ArchitectureRegistryController, ArchitectureRunsController],
  providers: [
    ArchitectureRegistryService,
    ArchitectureRunPreparationService,
    ArchitectureRuntimeAuditWriterService,
    ArchitectureRuntimeService,
    {
      provide: ARCHITECTURE_RUNTIME_STOP,
      useExisting: ArchitectureRuntimeService,
    },
    {
      provide: ARCHITECTURE_ROLE_EXECUTOR,
      useClass: ArchitectureRoleExecutorService,
    },
  ],
  exports: [ArchitectureRegistryService, ArchitectureRuntimeService],
})
export class ArchitectureModule {}
