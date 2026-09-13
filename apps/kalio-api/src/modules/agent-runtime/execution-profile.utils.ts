export interface ExecutionProfileSelection {
  explicitProfileId?: string | null;
  personaProfileId?: string | null;
  projectProfileId?: string | null;
}

export function resolveExecutionProfileId(selection: ExecutionProfileSelection): string {
  const candidates = [
    selection.explicitProfileId,
    selection.personaProfileId,
    selection.projectProfileId,
  ];
  const profileId = candidates.find((candidate): candidate is string =>
    typeof candidate === 'string' && candidate.trim().length > 0,
  );
  if (!profileId) {
    throw new Error('Execution profile is required to create a session.');
  }
  return profileId.trim();
}
