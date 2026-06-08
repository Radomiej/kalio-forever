export interface IEmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
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
