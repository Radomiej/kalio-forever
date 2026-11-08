export const TOOL_APPROVAL_CONTEXT = Symbol('TOOL_APPROVAL_CONTEXT');

/** Host lookup coordinates, never supplied by tool arguments or worker prose. */
export interface ToolApprovalContextBinding {
  readonly sessionId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly promptMessageId: string;
}

/** Explanatory evidence only. Recorded text does not grant execution permissions. */
export interface ToolApprovalContextSnapshot {
  readonly version: 1;
  readonly binding: ToolApprovalContextBinding;
  readonly project: { readonly id: string; readonly kind: string; readonly path: string | null };
  readonly lineage: readonly {
    readonly sessionId: string; readonly parentSessionId: string | null;
    readonly kind: string; readonly title: string;
  }[];
  readonly inputs: readonly {
    readonly messageId: string; readonly sessionId: string; readonly turnId: string | null;
    readonly origin: 'host_recorded_input' | 'delegated_objective'; readonly text: string;
  }[];
  readonly denials: readonly {
    readonly requestId: string; readonly sessionId: string; readonly toolName: string; readonly reason?: string;
  }[];
  readonly fingerprint: string;
}

export interface ToolApprovalContextPort {
  read(binding: ToolApprovalContextBinding): ToolApprovalContextSnapshot | null;
  /** Rebuild the complete selection, including newly appended inputs and denials. */
  isCurrent(binding: ToolApprovalContextBinding, fingerprint: string): boolean;
}
