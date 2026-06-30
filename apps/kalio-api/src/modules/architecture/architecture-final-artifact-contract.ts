export type ArchitectureFinalArtifactContractStatus = 'accepted' | 'blocked' | 'rejected' | 'incomplete';

export interface ArchitectureFinalArtifactContract {
  status: ArchitectureFinalArtifactContractStatus;
  blockingReason?: string;
  evidence: string[];
  answer?: string;
}

export const FINAL_ARTIFACT_CONTRACT_INSTRUCTION = [
  'Return finalArtifact status through the structured output schema: {"status":"accepted"|"blocked"|"rejected"|"incomplete","blockingReason":"...","evidence":["..."],"answer":"..."}.',
  'Use accepted only when incoming evidence proves the goal and verification passed.',
].join(' ');
