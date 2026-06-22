export function architectureSessionPrefixForRun(runId: string): string {
  const normalizedRunId = runId.trim();
  return normalizedRunId.startsWith('arch-') ? normalizedRunId : `arch-${normalizedRunId}`;
}

export function architectureSessionIdForRunSlot(
  runId: string,
  slotOrNodeId: string | undefined,
): string | undefined {
  const normalizedSlotOrNodeId = slotOrNodeId?.trim();
  if (!runId.trim() || !normalizedSlotOrNodeId) {
    return undefined;
  }
  return `${architectureSessionPrefixForRun(runId)}-${normalizedSlotOrNodeId}`;
}
