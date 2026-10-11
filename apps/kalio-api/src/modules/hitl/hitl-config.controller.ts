import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { DecisionAuthGuard } from '../../common/decision-auth.guard';
import { HitlConfigService } from './hitl-config.service';
import type { HitlConfig, UpdateHitlConfigDto } from './hitl.types';

@Controller('hitl')
export class HitlConfigController {
  constructor(private readonly hitlConfig: HitlConfigService) {}

  @Get('config')
  @UseGuards(DecisionAuthGuard)
  getConfig(): Promise<HitlConfig> {
    return this.hitlConfig.getConfig();
  }

  @Put('config')
  @UseGuards(DecisionAuthGuard)
  updateConfig(@Body() dto: UpdateHitlConfigDto): Promise<HitlConfig> {
    return this.hitlConfig.updateConfig(dto);
  }
}
