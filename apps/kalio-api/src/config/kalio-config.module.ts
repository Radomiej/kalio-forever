import { Global, Module } from '@nestjs/common';
import { KalioConfigService } from './kalio-config.service';

@Global()
@Module({
  providers: [KalioConfigService],
  exports: [KalioConfigService],
})
export class KalioConfigModule {}