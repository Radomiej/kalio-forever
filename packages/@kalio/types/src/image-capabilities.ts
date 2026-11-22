import type { ImageProviderType, ImageRef, ImageConfigResponse } from './image';
import type { NativeImageResult } from './native-image';

/** One capability table shared by Settings and runtime dispatch. No provider is recommended. */
export const IMAGE_PROVIDER_CAPABILITIES: Record<ImageProviderType, {
  label: string; generate: boolean; edit: boolean; needsApiKey: boolean;
  editTransport: 'gemini' | 'openai' | 'native' | null; maxReferences: number;
}> = {
  auto: { label: 'Legacy auto (CometAPI)', generate: true, edit: true, needsApiKey: true, editTransport: 'gemini', maxReferences: 14 },
  cometapi: { label: 'CometAPI', generate: true, edit: true, needsApiKey: true, editTransport: 'gemini', maxReferences: 14 },
  openai: { label: 'OpenAI API', generate: true, edit: true, needsApiKey: true, editTransport: 'openai', maxReferences: 16 },
  openrouter: { label: 'OpenRouter', generate: true, edit: false, needsApiKey: true, editTransport: null, maxReferences: 0 },
  replicate: { label: 'Replicate (direct)', generate: true, edit: false, needsApiKey: true, editTransport: null, maxReferences: 0 },
  chatgpt: { label: 'ChatGPT / Codex (integration)', generate: true, edit: true, needsApiKey: false, editTransport: 'native', maxReferences: 14 },
};

export const IMAGE_EDITOR = 'KALIO_IMAGE_EDITOR';
export interface ImageEditRequest {
  config: ImageConfigResponse;
  apiKey?: string;
  prompt: string;
  references: Array<{ ref: ImageRef; base64: string; mimeType: string }>;
  aspectRatio: string;
  imageSize: string;
  model?: string;
  thinkingLevel: string;
  abortSignal?: AbortSignal;
}
export interface ImageEditor {
  edit(request: ImageEditRequest): Promise<NativeImageResult>;
}
