import type { ToolCallRequest, ToolMeta } from '@kalio/types';

export interface ToolCatalogEntry {
  meta: ToolMeta;
  execute(req: ToolCallRequest): Promise<unknown>;
}

export interface ToolCatalogPort {
  getEntries?: () => ToolCatalogEntry[];
  getAllTools?: () => ToolMeta[];
  getToolsForSkills?: (skills: string[]) => ToolMeta[];
  setOverride?: (toolName: string, requiresConfirmation: boolean) => boolean;
}

export const TOOL_CATALOG = Symbol('TOOL_CATALOG');