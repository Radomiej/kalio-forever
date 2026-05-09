import { Controller, Get, Put, Body } from '@nestjs/common';
import { ImageConfigService } from './image-config.service';
import type { ImageConfigResponse, UpdateImageConfigDto } from '@kalio/types';

@Controller('image')
export class ImageConfigController {
  constructor(private readonly imageConfig: ImageConfigService) {}

  @Get('config')
  async getConfig(): Promise<ImageConfigResponse> {
    return this.imageConfig.getConfig();
  }

  @Put('config')
  async updateConfig(@Body() dto: UpdateImageConfigDto): Promise<ImageConfigResponse> {
    return this.imageConfig.updateConfig(dto);
  }
}
