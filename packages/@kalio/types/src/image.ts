export type ImageRefRole = 'character' | 'object' | 'style' | 'background' | 'base';

export interface ImageRef {
  vfsPath: string;
  role: ImageRefRole;
  label: string;
}

export type ImageDetail = 'low' | 'auto' | 'high';

export interface ImageCompressionConfig {
  enabled: boolean;
  maxDimension: number;   // px, e.g. 1024
  maxKb: number;          // max file size in KB, e.g. 512
  detail: ImageDetail;
}

export type ImageProviderType = 'cometapi' | 'openai' | 'openrouter' | 'replicate' | 'auto' | 'chatgpt';

export interface ImageProviderConfig {
  provider: ImageProviderType;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  executionProfileId?: string;
  editModel?: string;
  compression?: ImageCompressionConfig;
}

export interface ImageConfigResponse {
  provider: ImageProviderType;
  baseUrl?: string;
  model?: string;
  executionProfileId?: string;
  editModel?: string;
  compression?: ImageCompressionConfig;
  source: 'db' | 'default';
}

export interface UpdateImageConfigDto {
  provider?: ImageProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  executionProfileId?: string;
  editModel?: string;
  compression?: ImageCompressionConfig;
}

export interface ImageGenerateResult {
  image_url: string;    // base64 data URL
  path: string;         // VFS path where saved
  model: string;
  size: string;
  format: string;
  download_url: string;
  message: string;
}

export interface ImageEditResult {
  image_url: string;
  path: string;
  model: string;
  refCount: number;
  durationMs: number;
  download_url: string;
  message: string;
  iteratedFrom?: string;
}

