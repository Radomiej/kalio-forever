import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { ChatModule } from '../chat/chat.module';
import { VFSModule } from '../vfs/vfs.module';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { ARCHITECTURE_ROLE_EXECUTOR, ArchitectureRoleExecutorService } from './architecture-role-executor';
import { ArchitectureRuntimeService } from './architecture-runtime.service';
import { ArchitectureModule } from './architecture.module';

describe('ArchitectureModule', () => {
  it('wires architecture runtime through the role executor port', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, ArchitectureModule)).toContain(ChatModule);
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, ArchitectureModule)).toContain(VFSModule);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, ArchitectureModule)).toEqual([
      ArchitectureRegistryService,
      ArchitectureRuntimeService,
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ArchitectureModule)).toContainEqual({
      provide: ARCHITECTURE_ROLE_EXECUTOR,
      useClass: ArchitectureRoleExecutorService,
    });
  });
});
