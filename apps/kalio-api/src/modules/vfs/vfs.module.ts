import { Module } from '@nestjs/common';
import { VFSService } from './vfs.service';

@Module({
  providers: [VFSService],
  exports: [VFSService],
})
export class VFSModule {}
