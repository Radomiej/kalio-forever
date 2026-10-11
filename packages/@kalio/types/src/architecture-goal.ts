import type { Timestamp, WorkflowEvidence } from './index';

/** Canonical source resolved from a persisted user message, not worker prose. */
export interface ArchitectureGoalSourceV1 {
  messageId: string;
  sessionId: string;
  turnId: string;
  content: string;
  createdAt: Timestamp;
}

export interface ArchitectureGoalSourceQuoteV1 {
  messageId: string;
  quote: string;
}

/** Untrusted worker output: the host owns IDs and completion evidence policy. */
export interface ArchitectureGoalCriterionProposalV1 {
  text: string;
  sourceQuotes: readonly ArchitectureGoalSourceQuoteV1[];
  supersedes: readonly string[];
}

export interface ArchitectureGoalProjectionProposalV1 {
  sourceVersion: number;
  criteria: readonly ArchitectureGoalCriterionProposalV1[];
  proposalFingerprint: string;
}

export interface ArchitectureGoalCriterionV1 extends ArchitectureGoalCriterionProposalV1 {
  id: string;
}

export interface ArchitectureGoalAcceptedProjectionV1 {
  sourceVersion: number;
  /** Includes historical criteria; superseded rows are retained. */
  criteria: readonly ArchitectureGoalCriterionV1[];
  goalFingerprint: string;
}

export type ArchitectureGoalProjectionV1 =
  | { status: 'pending'; base: ArchitectureGoalAcceptedProjectionV1 | null; proposal?: ArchitectureGoalProjectionProposalV1 }
  | { status: 'accepted'; snapshot: ArchitectureGoalAcceptedProjectionV1 };

export interface ArchitectureGoalCompletionPolicyV1 {
  requiredEvidenceKindsByCriterion: Readonly<Record<string, readonly WorkflowEvidence['kind'][]>>;
}

export interface ArchitectureGoalPacketV1 {
  schemaVersion: 1;
  version: number;
  original: ArchitectureGoalSourceV1;
  updates: readonly ArchitectureGoalSourceV1[];
  sourceFingerprint: string;
  projection: ArchitectureGoalProjectionV1;
  completionPolicy: ArchitectureGoalCompletionPolicyV1;
}

export interface ArchitectureGoalDecisionBindingV1 {
  goalVersion: number;
  goalFingerprint: string;
  evidenceFingerprint: string;
  policyFingerprint: string;
}

/** Request disclosure is separate from canonical, unmodified durable sources. */
export interface ArchitectureGoalDecisionDisclosureV1 {
  completeness: 'complete' | 'sanitized' | 'incomplete';
  sources: readonly {
    messageId: string;
    mode: 'raw' | 'sanitized' | 'omitted';
    canonicalContentHash: string;
    transmittedContentHash?: string;
    transmittedBytes: number;
  }[];
}
