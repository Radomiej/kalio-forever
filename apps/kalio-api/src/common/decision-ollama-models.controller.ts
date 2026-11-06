import { Body, Controller, Get, Header, HttpException, Param, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DecisionOllamaInstallService } from './decision-ollama-install.service';
import { DecisionOllamaModelsGuard } from './decision-ollama-models.guard';
import { modelError, OllamaModelError } from './decision-ollama-models.types';

@Controller('decision/ollama')
@UseGuards(DecisionOllamaModelsGuard)
export class DecisionOllamaModelsController {
  constructor(private readonly installs: DecisionOllamaInstallService) {}
  @Get('models')
  @Header('Cache-Control', 'no-store')
  catalog() { return this.call(() => this.installs.catalog()); }
  @Put('install')
  @Header('Cache-Control', 'no-store')
  install(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    return this.call(async () => { const result = await this.installs.install(body); response.status(result.status); return result.body; });
  }
  @Get('install/:jobId')
  @Header('Cache-Control', 'no-store')
  job(@Param('jobId') id: string) { return this.call(() => this.installs.job(id)); }
  @Put('install/:jobId/cancel')
  @Header('Cache-Control', 'no-store')
  cancel(@Param('jobId') id: string, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    return this.call(() => { const result = this.installs.cancel(id, body); response.status(result.status); return result.body; });
  }
  private async call<T>(action: () => T | Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof OllamaModelError) throw new HttpException(modelError(error.code), error.status);
      throw new HttpException(modelError('OLLAMA_UNAVAILABLE'), 503);
    }
  }
}
