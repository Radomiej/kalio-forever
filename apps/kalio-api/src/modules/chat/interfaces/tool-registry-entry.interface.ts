import type { ToolMeta, ToolCallRequest } from '@kalio/types';

/**
 * Shape of a single entry in the TOOL_REGISTRY token.
 * Matches the public surface of @Tool()-decorated classes.
 */
export interface ToolRegistryEntry {
  readonly meta: ToolMeta;
  /** Host-owned restart comparison metadata, not execution/approval proof.
   * All three must be present for durable dispatch proof eligibility. */
  readonly catalogEntryId?: string;
  readonly executorImplementationId?: string;
  readonly executorImplementationVersion?: number;
  execute(req: ToolCallRequest): Promise<unknown>;
}
