export type ArchitectureFinalArtifactStatus = 'accepted' | 'blocked' | 'rejected' | 'incomplete';

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function finalArtifactStatusFromData(data: Record<string, unknown> | undefined): ArchitectureFinalArtifactStatus | undefined {
  if (!data) return undefined;
  const status = stringField(data, 'finalArtifactStatus') ?? stringField(data, 'acceptanceStatus');
  if (status === 'accepted' || status === 'blocked' || status === 'rejected' || status === 'incomplete') {
    return status;
  }
  if (typeof data['blockingReason'] === 'string' && data['blockingReason'].trim().length > 0) {
    return 'blocked';
  }
  if (typeof data['incompleteReason'] === 'string' && data['incompleteReason'].trim().length > 0) {
    return 'incomplete';
  }
  return undefined;
}
