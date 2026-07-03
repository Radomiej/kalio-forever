import type { ArchitectureGraphProjection, ArchitectureSchema } from '@kalio/types';

export function shouldOverlayPersistedChildAgents(
  schema: ArchitectureSchema | undefined,
  liveGraph: ArchitectureGraphProjection,
): boolean {
  if ((liveGraph.childAgents?.length ?? 0) > 0) {
    return true;
  }
  return schema?.roleSlots.some((slot) => slot.slotType === 'tool_executor') ?? false;
}
