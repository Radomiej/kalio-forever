export const GOAL_REVIEWER_CHILD_READER = Symbol('GOAL_REVIEWER_CHILD_READER');

/** Reservation classification only; never start authority or fresh binding proof. */
export interface ReservedReviewerChild {
  readonly admissionId: string;
  readonly descriptorSha256: string;
  readonly childSessionId: string;
  readonly plannedTurnId: string;
  readonly rootSessionId: string;
  readonly parentSessionId: string;
  readonly parentToolCallId: string;
  readonly state: 'admitted' | 'started' | 'cancelled';
  readonly revision: number;
}

export interface GoalReviewerChildReader {
  /** Null only after a successful authoritative lookup with no reservation. */
  readByChildSessionId(childSessionId: string): Readonly<ReservedReviewerChild> | null;
}
