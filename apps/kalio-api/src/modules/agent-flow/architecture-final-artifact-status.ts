const BLOCKING_FINAL_ARTIFACT_PATTERNS = [
  /\bwe\s+cannot\s+accept\b/i,
  /\bcannot\s+accept\b/i,
  /\bnot\s+acceptable\b/i,
  /build verification\s*[—-]\s*incomplete/i,
  /\bverification\s*[—-]\s*incomplete\b/i,
  /\bno\s+post-change\s+build\s+proof\b/i,
  /\bmissing\s+post-change\s+build\s+log\b/i,
  /\bmissing\s+build\s+(?:proof|evidence|log)\b/i,
  /\bstatus\s*:\s*blocked\b/i,
  /\bblocker\s*:/i,
  /\bblocker\s+remains\b/i,
  /\bsingle\s+blocker\b/i,
];

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

export function finalArtifactLegacyTextDeclaresBlockingStatus(message: string | undefined): boolean {
  if (!message) return false;
  return BLOCKING_FINAL_ARTIFACT_PATTERNS.some((pattern) => pattern.test(message));
}
