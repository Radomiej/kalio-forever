import { Module } from '@nestjs/common';
import { VFSService } from './vfs.service';
import { SessionVfsController } from './session-vfs.controller';

@Module({
  controllers: [SessionVfsController],
  providers: [VFSService],
  exports: [VFSService],
})
export class VFSModule {}
