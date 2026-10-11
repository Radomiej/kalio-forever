import { BadRequestException, Body, Controller, Get, Header, Inject, Put, UseGuards } from '@nestjs/common';
import { DECISION_SETTINGS, type DecisionSettings, type DecisionSettingsPort } from '@kalio/types';
import { DecisionAuthGuard } from './decision-auth.guard';

@Controller('decision')
@UseGuards(DecisionAuthGuard)
export class DecisionSettingsController {
  constructor(@Inject(DECISION_SETTINGS) private readonly decisions: DecisionSettingsPort) {}

  @Get('config')
  @Header('Cache-Control', 'no-store')
  getConfig(): Promise<DecisionSettings> { return this.decisions.getConfig(); }

  @Put('config')
  @Header('Cache-Control', 'no-store')
  updateConfig(@Body() input: unknown): Promise<DecisionSettings> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Invalid Decision Settings.');
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some((key) => !['provider', 'model', 'credentialId', 'endpoint'].includes(key))
      || (value['provider'] !== 'openrouter' && value['provider'] !== 'typesafe' && value['provider'] !== 'custom')
      || typeof value['model'] !== 'string' || typeof value['endpoint'] !== 'string'
      || !(value['credentialId'] === null || typeof value['credentialId'] === 'string')) {
      throw new BadRequestException('Invalid Decision Settings.');
    }
    return this.decisions.updateConfig(value as unknown as DecisionSettings);
  }
}
