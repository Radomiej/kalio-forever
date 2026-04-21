import { Controller, Get } from '@nestjs/common';
import { LLMService } from './llm.service';
import { CredentialsService } from '../credentials/credentials.service';
import type { LLMConfig } from '@kalio/types';

export interface LLMConfigResponse extends LLMConfig {
  contextWindowSize: number;
}

@Controller('llm')
export class LLMController {
  constructor(
    private readonly llm: LLMService,
    private readonly credentials: CredentialsService,
  ) {}

  @Get('config')
  async getConfig(): Promise<LLMConfigResponse> {
    const [config, contextWindowSize] = await Promise.all([
      this.llm.getConfig(),
      this.credentials.getContextWindowSize(),
    ]);
    return { ...config, contextWindowSize };
  }
}
