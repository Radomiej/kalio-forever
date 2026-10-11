import type { MemorySearchResult } from './index';

export interface ProjectContextSettings {
  enabled: boolean;
  modelRevision: string;
  providerScope: string;
}
export const PROJECT_CONTEXT_PORT = Symbol('PROJECT_CONTEXT_PORT');
export interface ProjectContextPort {
  refreshForSession(sessionId: string, request: ProjectResourceIndexRequest): Promise<ProjectResourceIndexResult>;
  searchForSession(sessionId: string, request: ProjectResourceSearchRequest): Promise<ProjectResourceSearchResult[]>;
}

/** Exact producer identity; changing any component requires a different space. */
export interface EmbeddingSpace {
  id: string;
  provider: string;
  /** Non-secret deployment/tenant label; 'unresolved' is not immutable identity. */
  providerScope: string;
  backend: string;
  /** SHA256 of normalized non-auth endpoint, not the raw URL. */
  endpointFingerprint: string;
  model: string;
  modelRevision: string;
  dimensions: number;
  promptVersion: string;
  documentPromptVersion: string;
  queryPromptVersion: string;
  codeQueryPromptVersion: string;
  normalizationVersion: string;
}

export type ResourceModality = 'text' | 'code' | 'image' | 'audio' | 'video' | 'pdf';
export type ResourceRepresentation = 'content' | 'metadata';
export interface ProjectResourceFile {
  path: string;
  sizeBytes: number;
  content: Uint8Array;
}
export interface ProjectResourceSnapshot {
  projectId: string;
  files: readonly ProjectResourceFile[];
  skipped: readonly { path: string; reason: string }[];
  /** Enumeration completed within bounds; skipped files are explicitly disclosed. */
  complete: true;
}
export const PROJECT_RESOURCE_READER = Symbol('PROJECT_RESOURCE_READER');
export interface ProjectResourceReaderPort {
  readProject(projectId: string, signal?: AbortSignal): Promise<ProjectResourceSnapshot>;
}
export interface ProjectResourceIndexRequest {
  /** Explicit consent for this operation only; never stored as global consent. */
  allowRemoteProcessing?: boolean;
}
export interface ProjectResourceSearchRequest extends ProjectResourceIndexRequest {
  query: string;
  resourceTypes?: ResourceModality[];
  limit?: number;
  mode?: 'vector' | 'fts' | 'hybrid';
}
export interface ProjectResourceIndexResult {
  projectId: string;
  space: EmbeddingSpace;
  indexedFiles: number;
  indexedChunks: number;
  skipped: readonly { path: string; reason: string }[];
  indexedAt: number;
}
export interface ProjectResourceSearchResult extends MemorySearchResult {
  projectId: string;
  spaceId: string;
  path: string;
  resourceType: ResourceModality;
  /** Metadata results do not claim understanding of binary asset contents. */
  representation: ResourceRepresentation;
}
