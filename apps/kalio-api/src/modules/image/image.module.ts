import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ImageGenerationService } from './image-generation.service';
import { ImageConfigService } from './image-config.service';
import { ImageConfigController } from './image-config.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [ImageConfigController],
  providers: [ImageGenerationService, ImageConfigService],
  exports: [ImageGenerationService, ImageConfigService],
})
export class ImageModule {}
