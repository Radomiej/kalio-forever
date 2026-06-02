import type { ArchitectureSchema } from '@kalio/types';

const BASE_CONTEXT_POLICY: ArchitectureSchema['contextPolicy'] = {
  includeUserTask: true,
  includeProjectMemory: true,
  includeBrowserSession: false,
  includePriorDecisions: true,
  includeOtherAgentOutputs: true,
  includeToolResults: true,
};

export const ARCHITECTURE_DEBATE: ArchitectureSchema = {
  id: 'architecture_debate',
  name: 'Architecture Debate',
  description: 'Lab-inspired debate preset: research fan-out, adversarial review, synthesis, and final architecture decision.',
  version: '0.1.0',
  roleSlots: [
    { id: 'orchestrator', label: 'Orchestrator', description: 'Defines the decision frame and acceptance criteria.', slotType: 'router', defaultPersonaId: 'agent-orchestrator', allowedPersonaTags: ['orchestration'], required: true, canOverrideAtRunStart: true },
    { id: 'researcher', label: 'Researcher', description: 'Collects current technical and project evidence.', slotType: 'participant', defaultPersonaId: 'agent-researcher', allowedPersonaTags: ['research'], required: true, canOverrideAtRunStart: true },
    { id: 'pragmatist', label: 'Pragmatist', description: 'Checks implementation feasibility, cost, and delivery risk.', slotType: 'participant', defaultPersonaId: 'agent-reviewer', allowedPersonaTags: ['delivery', 'risk'], required: true, canOverrideAtRunStart: true },
    { id: 'user_advocate', label: 'User Advocate', description: 'Checks workflow usability and visible product impact.', slotType: 'participant', defaultPersonaId: 'designer', allowedPersonaTags: ['ux'], required: true, canOverrideAtRunStart: true },
    { id: 'synthesizer', label: 'Synthesizer', description: 'Merges positions and selects the strongest route.', slotType: 'router', defaultPersonaId: 'agent-synthesizer', allowedPersonaTags: ['synthesis'], required: true, canOverrideAtRunStart: true },
    { id: 'finalizer', label: 'Finalizer', description: 'Writes the final architecture decision and next steps.', slotType: 'finalizer', defaultPersonaId: 'agent-synthesizer', allowedPersonaTags: ['writing'], required: true, canOverrideAtRunStart: true },
  ],
  nodes: [
    { id: 'orchestrator', label: 'Orchestrator', kind: 'router', roleSlotId: 'orchestrator', behavior: { mode: 'fan_out_all', fanOut: 'parallel', convergeToNodeId: 'synthesizer', scoringPolicy: 'risk', description: 'Fan out to debate roles.' }, x: 360, y: 40 },
    { id: 'researcher', label: 'Researcher', kind: 'role', roleSlotId: 'researcher', x: 120, y: 180 },
    { id: 'pragmatist', label: 'Pragmatist', kind: 'role', roleSlotId: 'pragmatist', x: 360, y: 180 },
    { id: 'user-advocate', label: 'User Advocate', kind: 'role', roleSlotId: 'user_advocate', x: 600, y: 180 },
    { id: 'synthesizer', label: 'Synthesizer', kind: 'router', roleSlotId: 'synthesizer', behavior: { mode: 'rank_then_merge', fanOut: 'sequential', convergeToNodeId: 'final-artifact', scoringPolicy: 'confidence', description: 'Rank evidence and merge the decision.' }, x: 360, y: 340 },
    { id: 'final-artifact', label: 'Architecture Decision', kind: 'artifact', roleSlotId: 'finalizer', behavior: { mode: 'finalize', description: 'Produce decision, risks, and next actions.' }, x: 360, y: 500 },
  ],
  edges: [
    { id: 'orchestrator-researcher', fromNodeId: 'orchestrator', toNodeId: 'researcher' },
    { id: 'orchestrator-pragmatist', fromNodeId: 'orchestrator', toNodeId: 'pragmatist' },
    { id: 'orchestrator-user-advocate', fromNodeId: 'orchestrator', toNodeId: 'user-advocate' },
    { id: 'researcher-synthesizer', fromNodeId: 'researcher', toNodeId: 'synthesizer' },
    { id: 'pragmatist-synthesizer', fromNodeId: 'pragmatist', toNodeId: 'synthesizer' },
    { id: 'user-advocate-synthesizer', fromNodeId: 'user-advocate', toNodeId: 'synthesizer' },
    { id: 'synthesizer-final', fromNodeId: 'synthesizer', toNodeId: 'final-artifact' },
  ],
  routerPolicy: { mode: 'risk_weighted', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
  contextPolicy: BASE_CONTEXT_POLICY,
  memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
  outputArtifactSchema: 'ArchitectureDecisionArtifact',
};

export const CODING_REVIEW: ArchitectureSchema = {
  id: 'coding_review',
  name: 'Coding Review',
  description: 'Lab-inspired implementer/reviewer loop for code changes with evidence-first acceptance.',
  version: '0.1.0',
  roleSlots: [
    { id: 'orchestrator', label: 'Orchestrator', description: 'Scopes the coding task and chooses the next node.', slotType: 'router', defaultPersonaId: 'agent-orchestrator', allowedPersonaTags: ['orchestration'], required: true, canOverrideAtRunStart: true },
    { id: 'implementer', label: 'Implementer', description: 'Makes or delegates concrete code changes.', slotType: 'tool_executor', defaultPersonaId: 'agent-implementer', allowedPersonaTags: ['implementation'], required: true, canOverrideAtRunStart: true },
    { id: 'reviewer', label: 'Reviewer', description: 'Finds defects, regressions, and missing evidence.', slotType: 'critic', defaultPersonaId: 'agent-reviewer', allowedPersonaTags: ['review'], required: true, canOverrideAtRunStart: true },
    { id: 'qa', label: 'QA', description: 'Runs focused verification and reports exact results.', slotType: 'tool_executor', defaultPersonaId: 'agent-qa', allowedPersonaTags: ['qa'], required: true, canOverrideAtRunStart: true },
    { id: 'release_guard', label: 'Release Guard', description: 'Accepts only when implementation and verification evidence are complete.', slotType: 'judge', defaultPersonaId: 'agent-release-guard', allowedPersonaTags: ['release'], required: true, canOverrideAtRunStart: true },
    { id: 'finalizer', label: 'Finalizer', description: 'Writes the verified completion report.', slotType: 'finalizer', defaultPersonaId: 'agent-synthesizer', allowedPersonaTags: ['writing'], required: true, canOverrideAtRunStart: true },
  ],
  nodes: [
    { id: 'orchestrator', label: 'Orchestrator', kind: 'router', roleSlotId: 'orchestrator', behavior: { mode: 'choose_one', fanOut: 'sequential', convergeToNodeId: 'implementer', scoringPolicy: 'risk', description: 'Start or route the coding loop.' }, x: 360, y: 40 },
    { id: 'implementer', label: 'Implementer', kind: 'role', roleSlotId: 'implementer', x: 360, y: 170 },
    { id: 'reviewer', label: 'Reviewer', kind: 'role', roleSlotId: 'reviewer', x: 360, y: 300 },
    { id: 'qa', label: 'QA', kind: 'role', roleSlotId: 'qa', x: 360, y: 430 },
    { id: 'release-guard', label: 'Release Guard', kind: 'router', roleSlotId: 'release_guard', behavior: { mode: 'choose_one', fanOut: 'sequential', convergeToNodeId: 'final-artifact', scoringPolicy: 'confidence', description: 'Route back to implementer until evidence proves completion.' }, x: 360, y: 560 },
    { id: 'final-artifact', label: 'Reviewed Change Report', kind: 'artifact', roleSlotId: 'finalizer', behavior: { mode: 'finalize', description: 'Summarize changes, tests, and release risk.' }, x: 360, y: 700 },
  ],
  edges: [
    { id: 'orchestrator-implementer', fromNodeId: 'orchestrator', toNodeId: 'implementer' },
    { id: 'implementer-reviewer', fromNodeId: 'implementer', toNodeId: 'reviewer' },
    { id: 'reviewer-qa', fromNodeId: 'reviewer', toNodeId: 'qa' },
    { id: 'qa-release-guard', fromNodeId: 'qa', toNodeId: 'release-guard' },
    { id: 'release-guard-final', fromNodeId: 'release-guard', toNodeId: 'final-artifact', label: 'accepted' },
    { id: 'release-guard-implementer', fromNodeId: 'release-guard', toNodeId: 'implementer', label: 'fix required', returnToOrchestrator: true },
  ],
  routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
  contextPolicy: { ...BASE_CONTEXT_POLICY, perSlotOverrides: { release_guard: { includeOtherAgentOutputs: true, includeToolResults: true, contextCompression: 'evidence_only' } } },
  memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
  outputArtifactSchema: 'CodeReviewArtifact',
};

export const DEEP_RESEARCH_FLOW: ArchitectureSchema = {
  id: 'deep_research',
  name: 'Deep Research',
  description: 'Lab-inspired research fan-out with critic and synthesis.',
  version: '0.1.0',
  roleSlots: [
    { id: 'orchestrator', label: 'Orchestrator', description: 'Frames the research question and routes the swarm.', slotType: 'router', defaultPersonaId: 'agent-orchestrator', allowedPersonaTags: ['orchestration'], required: true, canOverrideAtRunStart: true },
    { id: 'technical_research', label: 'Technical Research', description: 'Researches official docs, frameworks, and implementation constraints.', slotType: 'participant', defaultPersonaId: 'agent-researcher', allowedPersonaTags: ['research', 'technical'], required: true, canOverrideAtRunStart: true },
    { id: 'repo_research', label: 'Repo Research', description: 'Reads project files, history, and local evidence.', slotType: 'participant', defaultPersonaId: 'agent-researcher', allowedPersonaTags: ['repo', 'evidence'], required: true, canOverrideAtRunStart: true },
    { id: 'critic', label: 'Research Critic', description: 'Finds gaps, stale facts, contradictions, and weak sources.', slotType: 'critic', defaultPersonaId: 'agent-reviewer', allowedPersonaTags: ['critique'], required: true, canOverrideAtRunStart: true },
    { id: 'synthesizer', label: 'Synthesizer', description: 'Merges findings into cited conclusions and next actions.', slotType: 'finalizer', defaultPersonaId: 'agent-synthesizer', allowedPersonaTags: ['synthesis'], required: true, canOverrideAtRunStart: true },
  ],
  nodes: [
    { id: 'research-fanout', label: 'Research Fan-out', kind: 'parallel', behavior: { mode: 'fan_out_all', fanOut: 'parallel', convergeToNodeId: 'critic', scoringPolicy: 'confidence', description: 'Run technical and repo research in parallel.' }, x: 360, y: 40 },
    { id: 'technical-research', label: 'Technical Research', kind: 'role', roleSlotId: 'technical_research', x: 220, y: 180 },
    { id: 'repo-research', label: 'Repo Research', kind: 'role', roleSlotId: 'repo_research', x: 500, y: 180 },
    { id: 'critic', label: 'Research Critic', kind: 'role', roleSlotId: 'critic', x: 360, y: 330 },
    { id: 'final-artifact', label: 'Research Synthesis', kind: 'artifact', roleSlotId: 'synthesizer', behavior: { mode: 'finalize', description: 'Produce concise cited findings and next actions.' }, x: 360, y: 480 },
  ],
  edges: [
    { id: 'fanout-technical', fromNodeId: 'research-fanout', toNodeId: 'technical-research' },
    { id: 'fanout-repo', fromNodeId: 'research-fanout', toNodeId: 'repo-research' },
    { id: 'technical-critic', fromNodeId: 'technical-research', toNodeId: 'critic' },
    { id: 'repo-critic', fromNodeId: 'repo-research', toNodeId: 'critic' },
    { id: 'critic-final', fromNodeId: 'critic', toNodeId: 'final-artifact' },
  ],
  routerPolicy: { mode: 'rank_then_merge', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
  contextPolicy: BASE_CONTEXT_POLICY,
  memoryPolicy: { persistFinalArtifact: false, persistRouterDecision: false },
  outputArtifactSchema: 'ResearchArtifact',
};

export const RELEASE_GUARD: ArchitectureSchema = {
  id: 'release_guard',
  name: 'Release Guard',
  description: 'Final readiness gate that rejects release when evidence is missing, stale, or failing.',
  version: '0.1.0',
  roleSlots: [
    { id: 'qa', label: 'QA', description: 'Collects current verification evidence.', slotType: 'tool_executor', defaultPersonaId: 'agent-qa', allowedPersonaTags: ['qa'], required: true, canOverrideAtRunStart: true },
    { id: 'reviewer', label: 'Reviewer', description: 'Reviews residual risk and unresolved child statuses.', slotType: 'critic', defaultPersonaId: 'agent-reviewer', allowedPersonaTags: ['review'], required: true, canOverrideAtRunStart: true },
    { id: 'release_guard', label: 'Release Guard', description: 'Decides GO or NO-GO from evidence.', slotType: 'judge', defaultPersonaId: 'agent-release-guard', allowedPersonaTags: ['release'], required: true, canOverrideAtRunStart: true },
    { id: 'finalizer', label: 'Finalizer', description: 'Writes the release decision report.', slotType: 'finalizer', defaultPersonaId: 'agent-synthesizer', allowedPersonaTags: ['writing'], required: true, canOverrideAtRunStart: true },
  ],
  nodes: [
    { id: 'qa', label: 'QA Evidence', kind: 'role', roleSlotId: 'qa', x: 240, y: 80 },
    { id: 'reviewer', label: 'Risk Review', kind: 'role', roleSlotId: 'reviewer', x: 500, y: 80 },
    { id: 'release-guard', label: 'Release Guard', kind: 'router', roleSlotId: 'release_guard', behavior: { mode: 'choose_one', fanOut: 'sequential', convergeToNodeId: 'final-artifact', scoringPolicy: 'risk', description: 'Reject unless all evidence supports release.' }, x: 360, y: 240 },
    { id: 'final-artifact', label: 'Release Decision', kind: 'artifact', roleSlotId: 'finalizer', behavior: { mode: 'finalize', description: 'GO/NO-GO with evidence and remediation.' }, x: 360, y: 390 },
  ],
  edges: [
    { id: 'qa-release-guard', fromNodeId: 'qa', toNodeId: 'release-guard' },
    { id: 'reviewer-release-guard', fromNodeId: 'reviewer', toNodeId: 'release-guard' },
    { id: 'release-guard-final', fromNodeId: 'release-guard', toNodeId: 'final-artifact' },
  ],
  routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
  contextPolicy: { ...BASE_CONTEXT_POLICY, contextCompression: 'evidence_only' },
  memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
  outputArtifactSchema: 'ReleaseReadinessArtifact',
};
