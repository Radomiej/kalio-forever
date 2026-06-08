import type { ArchitectureSchema } from '@kalio/types';

export const GOAL_MASTER_DELIVERY_LOOP: ArchitectureSchema = {
  id: 'goal-master-delivery-loop',
  name: 'Goal Master Delivery Loop',
  description: 'A goal-driven implementation loop where a Goal Master verifies completion and routes back until acceptance criteria pass.',
  version: '0.1.0',
  roleSlots: [
    { id: 'orchestrator', label: 'Orchestrator', description: 'Defines acceptance criteria, decomposes the task, and delegates to Kalio sub-agents or CLI child agents while owning workflow continuity.', slotType: 'router', defaultPersonaId: 'agent-orchestrator', allowedPersonaTags: ['orchestration', 'planning'], required: true, canOverrideAtRunStart: true },
    { id: 'implementer', label: 'Implementer', description: 'Makes the smallest viable code or content change directly with tools or through a CLI child agent, then reports write evidence.', slotType: 'tool_executor', defaultPersonaId: 'agent-implementer', allowedPersonaTags: ['implementation', 'tools'], required: true, canOverrideAtRunStart: true },
    { id: 'verifier', label: 'Verifier', description: 'Runs the narrowest executable verification, inspects referenced CLI child agents, and reports tool evidence.', slotType: 'tool_executor', defaultPersonaId: 'agent-qa', allowedPersonaTags: ['qa', 'tools'], required: true, canOverrideAtRunStart: true },
    { id: 'tester', label: 'Tester', description: 'Runs targeted verification and reports exact failures.', slotType: 'participant', defaultPersonaId: 'agent-qa', allowedPersonaTags: ['qa', 'testing'], required: true, canOverrideAtRunStart: true },
    { id: 'goal_master', label: 'Goal Master', description: 'Judges whether the goal is fully met. Routes back to implementation when evidence is incomplete.', slotType: 'judge', defaultPersonaId: 'agent-release-guard', allowedPersonaTags: ['review', 'quality', 'goal'], required: true, canOverrideAtRunStart: true },
    { id: 'finalizer', label: 'Finalizer', description: 'Writes the verified completion report and residual risks.', slotType: 'finalizer', defaultPersonaId: 'agent-synthesizer', allowedPersonaTags: ['writing', 'delivery'], required: true, canOverrideAtRunStart: true },
  ],
  nodes: [
    { id: 'orchestrator', label: 'Orchestrator', kind: 'router', roleSlotId: 'orchestrator', behavior: { mode: 'choose_one', fanOut: 'sequential', convergeToNodeId: 'implementer', scoringPolicy: 'risk', description: 'Start with implementation, or route to a different node if the orchestrator returns routeToNodeId.' }, x: 360, y: 40 },
    { id: 'implementer', label: 'Implementer', kind: 'role', roleSlotId: 'implementer', x: 360, y: 170 },
    { id: 'verifier', label: 'Verifier', kind: 'role', roleSlotId: 'verifier', x: 360, y: 300 },
    { id: 'tester', label: 'Tester', kind: 'role', roleSlotId: 'tester', x: 360, y: 430 },
    { id: 'goal-master', label: 'Goal Master', kind: 'router', roleSlotId: 'goal_master', behavior: { mode: 'choose_one', fanOut: 'sequential', convergeToNodeId: 'final-artifact', scoringPolicy: 'confidence', description: 'Choose final-artifact when acceptance evidence is complete; routeToNodeId=implementer to continue.' }, x: 360, y: 560 },
    { id: 'final-artifact', label: 'Verified Completion Artifact', kind: 'artifact', roleSlotId: 'finalizer', behavior: { mode: 'finalize', description: 'Summarize changes, verification evidence, remaining risks, and next best action.' }, x: 360, y: 690 },
  ],
  edges: [
    { id: 'orchestrator-implementer', fromNodeId: 'orchestrator', toNodeId: 'implementer' },
    { id: 'implementer-verifier', fromNodeId: 'implementer', toNodeId: 'verifier' },
    { id: 'verifier-tester', fromNodeId: 'verifier', toNodeId: 'tester' },
    { id: 'tester-goal-master', fromNodeId: 'tester', toNodeId: 'goal-master' },
    { id: 'goal-master-final', fromNodeId: 'goal-master', toNodeId: 'final-artifact', label: 'goal complete' },
    { id: 'goal-master-implementer', fromNodeId: 'goal-master', toNodeId: 'implementer', label: 'continue', returnToOrchestrator: true },
  ],
  routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
  contextPolicy: {
    includeUserTask: true,
    includeProjectMemory: true,
    includeBrowserSession: false,
    includePriorDecisions: true,
    includeOtherAgentOutputs: true,
    includeToolResults: true,
    perSlotOverrides: {
      implementer: { includeOtherAgentOutputs: true, includeToolResults: true, contextCompression: 'summary' },
      verifier: { includeOtherAgentOutputs: true, includeToolResults: true, contextCompression: 'evidence_only' },
      goal_master: { includeOtherAgentOutputs: true, includeToolResults: true, contextCompression: 'evidence_only' },
    },
  },
  memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
  outputArtifactSchema: 'GoalCompletionArtifact',
};
