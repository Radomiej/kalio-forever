import { Module } from '@nestjs/common';
import { ToolController } from './tool.controller';
import { ToolApplicationConfigModule } from '../../config/tool-application-config.module';

@Module({
  imports: [ToolApplicationConfigModule],
  controllers: [ToolController],
  exports: [ToolApplicationConfigModule],
})
export class ToolModule {}
