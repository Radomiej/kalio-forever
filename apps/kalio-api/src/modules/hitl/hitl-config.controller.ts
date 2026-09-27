import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { HitlConfigService } from './hitl-config.service';
import type { HitlConfig, UpdateHitlConfigDto } from './hitl.types';
import { ControlPlaneAuthGuard } from '../../common/control-plane-auth';

@Controller('hitl')
@UseGuards(ControlPlaneAuthGuard)
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
