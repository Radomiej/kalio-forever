import { Module } from '@nestjs/common';
import { RuntimeInfoController } from './runtime-info.controller';

@Module({
  controllers: [RuntimeInfoController],
})
export class EmbeddedUiModule {}
