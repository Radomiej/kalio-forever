import type { ArchitectureExecutionEvent, ArchitectureRoleSlot, ArchitectureSchemaNode } from '@kalio/types';
import { architectureActionSummaryForEvent } from './architecture-action-summary';

type FinalArtifactEventOptions = {
  actionSummary?: string;
  lifecycle: NonNullable<ArchitectureExecutionEvent['lifecycle']>;
  status: NonNullable<ArchitectureExecutionEvent['status']>;
  nodeId: string;
  roleSlotId?: string;
  reasonCode: NonNullable<ArchitectureExecutionEvent['reasonCode']>;
  evidence: NonNullable<ArchitectureExecutionEvent['evidence']>;
  runtimeDecision: NonNullable<ArchitectureExecutionEvent['runtimeDecision']>;
  data: Record<string, unknown>;
};

type FinalArtifactProjection = {
  message: string;
  options: FinalArtifactEventOptions;
};

type SynthesizedArtifactInput = {
  node: ArchitectureSchemaNode;
  incomingEvents: ArchitectureExecutionEvent[];
};

type SynthesizedArtifactProjectionInput = SynthesizedArtifactInput & {
  incomingNodeIds: string[];
  rootSessionId?: string;
  personaId?: string;
};

type RoleFinalArtifactInput = {
  node: ArchitectureSchemaNode;
  slot: ArchitectureRoleSlot;
  branchSessionId: string;
  message: string;
  data: Record<string, unknown>;
  incomingNodeIds: string[];
  outgoingNodeIds: string[];
};

const FINAL_ARTIFACT_ACCEPTED = 'final_artifact_accepted' as const;

export function synthesizedArtifactMessage(input: SynthesizedArtifactInput): string {
  const incomingEvents = input.incomingEvents.filter((event) => (
    event.type === 'participant_output'
    || event.type === 'router_decision'
    || event.type === 'router_output'
  ));
  if (incomingEvents.length === 0) {
    return `${input.node.label} synthesized from graph execution.`;
  }
  const sections = incomingEvents.map((event) => {
    const label = event.roleSlotId ?? event.nodeId ?? event.type;
    return `From ${label}:\n${event.message}`;
  });
  return `${input.node.label}\n\n${sections.join('\n\n')}`;
}

export function finalArtifactFromSynthesizedGraphOutputs(
  input: SynthesizedArtifactProjectionInput,
): FinalArtifactProjection {
  const source = input.node.roleSlotId ?? input.node.id;
  return {
    message: synthesizedArtifactMessage(input),
    options: {
      actionSummary: architectureActionSummaryForEvent('final_artifact', 'artifact'),
      lifecycle: 'done',
      status: 'done',
      nodeId: input.node.id,
      roleSlotId: input.node.roleSlotId,
      reasonCode: FINAL_ARTIFACT_ACCEPTED,
      evidence: [{
        kind: 'FINAL_ARTIFACT',
        source,
        status: 'passed',
        data: {
          nodeId: input.node.id,
          roleSlotId: input.node.roleSlotId,
          rootSessionId: input.rootSessionId,
        },
      }],
      runtimeDecision: finalArtifactRuntimeDecision(),
      data: {
        reasonCode: FINAL_ARTIFACT_ACCEPTED,
        runtimeDecision: finalArtifactRuntimeDecision(),
        rootSessionId: input.rootSessionId,
        personaId: input.personaId,
        incomingNodeIds: input.incomingNodeIds,
      },
    },
  };
}

export function finalArtifactFromRoleResult(input: RoleFinalArtifactInput): FinalArtifactProjection {
  return {
    message: input.message,
    options: {
      actionSummary: architectureActionSummaryForEvent('final_artifact', 'artifact'),
      lifecycle: 'done',
      status: 'done',
      nodeId: input.node.id,
      roleSlotId: input.slot.id,
      reasonCode: FINAL_ARTIFACT_ACCEPTED,
      evidence: [{
        kind: 'FINAL_ARTIFACT',
        source: input.slot.id,
        status: 'passed',
        data: {
          ...input.data,
          nodeId: input.node.id,
          roleSlotId: input.slot.id,
          branchSessionId: input.branchSessionId,
        },
      }],
      runtimeDecision: finalArtifactRuntimeDecision(),
      data: {
        ...input.data,
        reasonCode: FINAL_ARTIFACT_ACCEPTED,
        runtimeDecision: finalArtifactRuntimeDecision(),
        incomingNodeIds: input.incomingNodeIds,
        outgoingNodeIds: input.outgoingNodeIds,
      },
    },
  };
}

function finalArtifactRuntimeDecision(): NonNullable<ArchitectureExecutionEvent['runtimeDecision']> {
  return {
    status: 'done',
    accepted: true,
    reasonCode: FINAL_ARTIFACT_ACCEPTED,
  };
}
