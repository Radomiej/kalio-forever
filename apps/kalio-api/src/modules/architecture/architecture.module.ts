import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { CLIAgentModule } from '../cli-agent/cli-agent.module';
import { VFSModule } from '../vfs/vfs.module';
import { ArchitectureRegistryController } from './architecture-registry.controller';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { ARCHITECTURE_ROLE_EXECUTOR, ArchitectureRoleExecutorService } from './architecture-role-executor';
import { ArchitectureRunsController } from './architecture-runs.controller';
import { ArchitectureRuntimeService } from './architecture-runtime.service';

@Module({
  imports: [ChatModule, VFSModule, CLIAgentModule],
  controllers: [ArchitectureRegistryController, ArchitectureRunsController],
  providers: [
    ArchitectureRegistryService,
    ArchitectureRuntimeService,
    {
      provide: ARCHITECTURE_ROLE_EXECUTOR,
      useClass: ArchitectureRoleExecutorService,
    },
  ],
  exports: [ArchitectureRegistryService, ArchitectureRuntimeService],
})
export class ArchitectureModule {}
