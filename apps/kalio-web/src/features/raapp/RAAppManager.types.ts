import type { RAAppBlock, VFSFile } from '@kalio/types';

export interface CatalogRunTarget {
  id: string;
  name: string;
  description?: string;
}

export interface FoundRAApp {
  messageId: string;
  block: RAAppBlock;
  index: number;
}

export interface WorkDraft {
  id: string;
  files: VFSFile[];
  updatedAt: number;
}
