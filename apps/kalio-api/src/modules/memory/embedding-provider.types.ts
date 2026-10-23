export interface IEmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  getModelIdentity?(): { modelRevision: string; providerScope: string } | undefined;
  getInputSizer?(): Promise<((text: string) => boolean) | undefined>;
  getActiveBackend?(): 'webgpu' | 'cpu' | null;
  isGpuAvailable?(): boolean | undefined;
  dispose?(): Promise<void> | void;
}

export interface EmbeddingProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
}
