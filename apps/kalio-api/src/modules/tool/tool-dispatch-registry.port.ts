import type { ToolCatalogEntry } from './tool-catalog.port';

export interface ToolDispatchRegistryPort {
  getEntries(): ToolCatalogEntry[];
}

export const TOOL_DISPATCH_REGISTRY = Symbol('TOOL_DISPATCH_REGISTRY');