import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppSettingsService } from '../../database/app-settings.service';
import { TimeoutSettingsService } from '../credentials/timeout-settings.service';
import { WebSearchHistoryStore, type HistoricalWebSearchResult } from './web-search-history.store';

export type SearchProvider = 'perplexity' | 'perplexity-openrouter';

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export interface SearchResult {
  answer: string;
  citations: string[];
  model: string;
  provider: SearchProvider;
}

export interface WebSearchResponse {
  result: SearchResult;
  historicalSearch?: HistoricalWebSearchResult[];
  historicalSearchHint?: string;
}

const HISTORICAL_SEARCH_HINT =
  'Related prior web_search answers were included. Use search_historical_web_search with a focused query to retrieve more persisted WebSearch history.';

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  citations?: string[];
  model?: string;
}

@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly appSettings: AppSettingsService,
    private readonly timeoutSettings: TimeoutSettingsService,
    private readonly historyStore: WebSearchHistoryStore,
  ) {}

  async getConfig(): Promise<{ provider: SearchProvider; apiKey: string | null }> {
    const storedProvider = await this.appSettings.get('search.provider');
    const storedApiKey = await this.appSettings.get('search.api_key');

    const provider: SearchProvider =
      (storedProvider as SearchProvider | null) ??
      (this.configService.get<string>('PERPLEXITY_PROVIDER') as SearchProvider | undefined) ??
      'perplexity';

    const apiKey =
      storedApiKey ??
      this.configService.get<string>('PERPLEXITY_API_KEY', '') ??
      null;

    return { provider, apiKey: apiKey || null };
  }

  async search(query: string): Promise<WebSearchResponse> {
    const { provider, apiKey } = await this.getConfig();

    if (!apiKey) {
      throw new Error(
        'Web search not configured. Add a Perplexity API key in Settings → Web Search.',
      );
    }

    const url = provider === 'perplexity-openrouter' ? OPENROUTER_URL : PERPLEXITY_URL;
    const model = provider === 'perplexity-openrouter' ? 'perplexity/sonar' : 'sonar';
    const timeoutMs = await this.timeoutSettings.getWebSearchTimeoutMs();

    this.logger.debug(`[web_search] query=${query.slice(0, 80)} provider=${provider}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful search assistant. Provide concise, factual answers with sources.',
          },
          { role: 'user', content: query },
        ],
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Search API error ${response.status}: ${text.slice(0, 300)}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;

    const result: SearchResult = {
      answer: data.choices?.[0]?.message?.content ?? '',
      citations: data.citations ?? [],
      model: data.model ?? model,
      provider,
    };

    const inserted = this.historyStore.insert({ query, ...result });
    const historicalSearch = this.historyStore.search(query, 5, inserted.id);

    return historicalSearch.length > 0
      ? { result, historicalSearch, historicalSearchHint: HISTORICAL_SEARCH_HINT }
      : { result };
  }
}
