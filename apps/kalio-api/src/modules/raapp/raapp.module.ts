import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RAAppService } from './raapp.service';
import { RAAppSandboxService } from './raapp-sandbox.service';
import { RAAppController } from './raapp.controller';
import { RAAppHITLService } from './raapp-hitl.service';
import { EffectsProcessorService } from './effects-processor.service';
import { NativeSystemRegistry } from './native/native-system-registry.service';
import { HttpFetchSystem } from './native/systems/http-fetch.system';
import { VfsNativeSystems } from './native/systems/vfs.systems';
import { RAAppVersioningService } from './raapp-versioning.service';
import { VFSModule } from '../vfs/vfs.module';
import { AuditService } from '../chat/audit.service';

@Module({
  imports: [VFSModule, ConfigModule],
  controllers: [RAAppController],
  providers: [
    RAAppService,
    RAAppSandboxService,
    NativeSystemRegistry,
    HttpFetchSystem,
    VfsNativeSystems,
    EffectsProcessorService,
    RAAppHITLService,
    RAAppVersioningService,
    AuditService,
  ],
  exports: [RAAppService, RAAppSandboxService, RAAppHITLService, EffectsProcessorService, NativeSystemRegistry, RAAppVersioningService, AuditService],
})
export class RAAppModule {}
