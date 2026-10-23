import type { ArchitectureSchema } from '@kalio/types';

/** Registration is deferred until the host goal adapter supports the complete loop. */
export const DEVIN_JEV_GOAL_LOOP: ArchitectureSchema = {
  id: 'devin-jev-goal-loop',
  name: 'Devin–Jev Goal Loop',
  description: 'Devin executes the approved goal; Jev reviews it and the host publishes authorized completion.',
  version: '0.1.0',
  roleSlots: [
    {
      id: 'worker', label: 'Devin worker', description: 'Execute through the exact persisted host Devin profile and approved project.',
      slotType: 'tool_executor', defaultPersonaId: 'agent-implementer', allowedPersonaTags: ['implementation', 'tools'],
      required: true, canOverrideAtRunStart: false,
    },
    {
      id: 'judge', label: 'Jev judge', description: 'Host Decisions API review; persona is metadata, not an execution provider.',
      slotType: 'judge', defaultPersonaId: 'agent-release-guard', allowedPersonaTags: ['review', 'quality', 'goal'],
      required: true, canOverrideAtRunStart: false,
    },
  ],
  // The existing scheduler starts the first node when a cyclic graph has no roots.
  nodes: [
    { id: 'devin-worker', label: 'Devin worker', kind: 'role', roleSlotId: 'worker' },
    { id: 'jev-judge', label: 'Jev judge', kind: 'role', roleSlotId: 'judge', toolOverride: { allowedToolNames: [] } },
    { id: 'goal-artifact', label: 'Verified goal artifact', kind: 'artifact', behavior: { mode: 'finalize' } },
  ],
  edges: [
    { id: 'worker-judge', fromNodeId: 'devin-worker', toNodeId: 'jev-judge' },
    { id: 'judge-continue', fromNodeId: 'jev-judge', toNodeId: 'devin-worker', selection: 'continuation' },
    { id: 'judge-complete', fromNodeId: 'jev-judge', toNodeId: 'goal-artifact', selection: 'choice' },
  ],
  routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
  contextPolicy: {
    includeUserTask: true, includeProjectMemory: true, includeBrowserSession: false,
    includePriorDecisions: true, includeOtherAgentOutputs: true, includeToolResults: true,
  },
  memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
  outputArtifactSchema: 'GoalCompletionArtifact',
};
