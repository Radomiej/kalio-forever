/** Native image generation reuses the selected agent integration and its login. */
export const NATIVE_IMAGE_GENERATOR = 'KALIO_NATIVE_IMAGE_GENERATOR';

export interface NativeImageRequest {
  executionProfileId: string;
  prompt: string;
  size: string;
  quality: 'low' | 'medium' | 'high';
  outputFormat: 'png' | 'jpeg' | 'webp';
  abortSignal?: AbortSignal;
  references?: Array<{ dataUrl: string; label: string; role: string }>;
}

export interface NativeImageResult {
  bytes: Uint8Array;
  mimeType: string;
  format: string;
  model: string;
  width: number;
  height: number;
}

export interface NativeImageGenerator {
  generate(request: NativeImageRequest): Promise<NativeImageResult>;
}
