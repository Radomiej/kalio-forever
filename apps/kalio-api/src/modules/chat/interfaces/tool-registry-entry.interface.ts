import type { ToolMeta, ToolCallRequest } from '@kalio/types';

/**
 * Shape of a single entry in the TOOL_REGISTRY token.
 * Matches the public surface of @Tool()-decorated classes.
 */
export interface ToolRegistryEntry {
  readonly meta: ToolMeta;
  execute(req: ToolCallRequest): Promise<unknown>;
}
