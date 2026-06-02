import { Body, Controller, Get, Put } from '@nestjs/common';
import { HitlConfigService } from './hitl-config.service';
import type { HitlConfig, UpdateHitlConfigDto } from './hitl.types';

@Controller('hitl')
export class HitlConfigController {
  constructor(private readonly hitlConfig: HitlConfigService) {}

  @Get('config')
  getConfig(): Promise<HitlConfig> {
    return this.hitlConfig.getConfig();
  }

  @Put('config')
  updateConfig(@Body() dto: UpdateHitlConfigDto): Promise<HitlConfig> {
    return this.hitlConfig.updateConfig(dto);
  }
}