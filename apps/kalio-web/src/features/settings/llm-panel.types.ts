export interface LLMConfigWithSource {
  provider: string;
  model: string;
  baseUrl: string;
  contextWindowSize: number;
  maxToolAttempts: number;
  source: 'db' | 'env';
}

export interface AddForm {
  name: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  nameEdited?: boolean;
}

export type ProviderTestState = 'idle' | 'testing' | 'ok' | 'error';

export interface ActiveRuntimeConfig {
  source: 'db' | 'env';
  provider: string;
  model: string;
  baseUrl: string;
  displayName: string;
  credentialId?: string;
}