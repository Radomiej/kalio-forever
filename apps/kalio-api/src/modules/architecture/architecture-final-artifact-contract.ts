export type ArchitectureFinalArtifactContractStatus = 'accepted' | 'blocked' | 'rejected' | 'incomplete';

export interface ArchitectureFinalArtifactContract {
  status: ArchitectureFinalArtifactContractStatus;
  blockingReason?: string;
  evidence: string[];
}

export const FINAL_ARTIFACT_CONTRACT_INSTRUCTION = [
  'End with a fenced JSON finalArtifact object: {"status":"accepted"|"blocked"|"rejected"|"incomplete","blockingReason":"...","evidence":["..."]}.',
  'Use accepted only when incoming evidence proves the goal and verification passed.',
].join(' ');

export function parseFinalArtifactContract(message: string): ArchitectureFinalArtifactContract | null {
  const candidates = [
    ...extractFencedJsonBlocks(message),
    ...extractTaggedJsonObjects(message, 'finalArtifact'),
    ...extractTaggedJsonObjects(message, 'final_artifact'),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!isRecord(parsed)) {
        continue;
      }
      const status = parsed['status'];
      if (status !== 'accepted' && status !== 'blocked' && status !== 'rejected' && status !== 'incomplete') {
        continue;
      }
      const blockingReason = typeof parsed['blockingReason'] === 'string' ? parsed['blockingReason'] : undefined;
      const evidence = Array.isArray(parsed['evidence'])
        ? parsed['evidence'].filter((item): item is string => typeof item === 'string')
        : [];
      return { status, blockingReason, evidence };
    } catch {
      continue;
    }
  }
  return null;
}

function extractFencedJsonBlocks(text: string): string[] {
  return [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]?.trim() ?? '');
}

function extractTaggedJsonObjects(text: string, tag: string): string[] {
  const tagIndex = text.indexOf(tag);
  if (tagIndex < 0) {
    return [];
  }
  const braceIndex = text.indexOf('{', tagIndex);
  if (braceIndex < 0) {
    return [];
  }
  const block = balancedJsonObject(text, braceIndex);
  return block ? [block] : [];
}

function balancedJsonObject(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
