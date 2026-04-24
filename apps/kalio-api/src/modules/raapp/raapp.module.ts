import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RAAppService } from './raapp.service';
import { RAAppSandboxService } from './raapp-sandbox.service';
import { RAAppController } from './raapp.controller';
import { VFSModule } from '../vfs/vfs.module';

@Module({
  imports: [VFSModule, ConfigModule],
  controllers: [RAAppController],
  providers: [RAAppService, RAAppSandboxService],
  exports: [RAAppService, RAAppSandboxService],
})
export class RAAppModule {}
