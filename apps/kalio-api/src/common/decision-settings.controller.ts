import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { DECISION_SETTINGS, type DecisionSettings, type DecisionSettingsPort } from '@kalio/types';
import { ControlPlaneAuthGuard } from './control-plane-auth';

@Controller('decision')
@UseGuards(ControlPlaneAuthGuard)
export class DecisionSettingsController {
  constructor(@Inject(DECISION_SETTINGS) private readonly decisions: DecisionSettingsPort) {}

  @Get('config')
  getConfig(): Promise<DecisionSettings> { return this.decisions.getConfig(); }

  @Put('config')
  updateConfig(@Body() config: DecisionSettings): Promise<DecisionSettings> { return this.decisions.updateConfig(config); }
}
