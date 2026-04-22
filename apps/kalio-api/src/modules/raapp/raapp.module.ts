import { Module } from '@nestjs/common';
import { RAAppService } from './raapp.service';
import { RAAppSandboxService } from './raapp-sandbox.service';
import { VFSModule } from '../vfs/vfs.module';

@Module({
  imports: [VFSModule],
  providers: [RAAppService, RAAppSandboxService],
  exports: [RAAppService, RAAppSandboxService],
})
export class RAAppModule {}
