import { Controller, Get, Put, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { WebSearchService, type SearchProvider } from './web-search.service';
import { AppSettingsService } from '../../database/app-settings.service';

interface SearchConfigDto {
  provider: SearchProvider;
  apiKey?: string;
}

interface SearchConfig {
  provider: SearchProvider;
  configured: boolean;
  apiKeyMasked: string | null;
}

@Controller('search')
export class SearchController {
  constructor(
    private readonly webSearch: WebSearchService,
    private readonly appSettings: AppSettingsService,
  ) {}

  @Get('config')
  async getConfig(): Promise<SearchConfig> {
    const { provider, apiKey } = await this.webSearch.getConfig();
    return {
      provider,
      configured: !!apiKey,
      apiKeyMasked: apiKey ? `${apiKey.slice(0, 8)}…` : null,
    };
  }

  @Put('config')
  async setConfig(@Body() dto: SearchConfigDto): Promise<SearchConfig> {
    await this.appSettings.set('search.provider', dto.provider);
    if (dto.apiKey) {
      await this.appSettings.set('search.api_key', dto.apiKey);
    }
    const { provider, apiKey } = await this.webSearch.getConfig();
    return {
      provider,
      configured: !!apiKey,
      apiKeyMasked: apiKey ? `${apiKey.slice(0, 8)}…` : null,
    };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.webSearch.search('ping test — respond with one word');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
