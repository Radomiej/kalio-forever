import type { ArchitectureRouterInsight, ArchitectureRouterOutput, ArchitectureRouterRisk } from '@kalio/types';
import type { ArchitectureFinalArtifactContract } from './architecture-final-artifact-contract';

export interface ArchitectureRouteDecision {
  targetNodeId: string;
  response?: string;
  routerOutput: ArchitectureRouterOutput;
}

export function structuredRouteToCall(output: unknown): ArchitectureRouteDecision | null {
  const routerOutput = routerOutputFromStructuredOutput(output);
  if (!routerOutput) {
    return null;
  }
  const targetNodeId = routerOutput.targetNodeId?.trim();
  if (!targetNodeId || !/^[A-Za-z0-9_.:-]+$/.test(targetNodeId)) {
    return null;
  }
  const response = routerOutput.response?.trim() || routerOutput.mergedDecision.trim() || undefined;
  return { targetNodeId, response, routerOutput };
}

export function finalArtifactContractFromStructuredOutput(output: unknown): ArchitectureFinalArtifactContract | null {
  if (!isRecord(output)) {
    return null;
  }
  const status = output['status'] ?? output['finalArtifactStatus'] ?? output['acceptanceStatus'];
  if (status !== 'accepted' && status !== 'blocked' && status !== 'rejected' && status !== 'incomplete') {
    return null;
  }
  const blockingReason = typeof output['blockingReason'] === 'string' ? output['blockingReason'] : undefined;
  const evidence = Array.isArray(output['evidence'])
    ? output['evidence'].filter((item): item is string => typeof item === 'string')
    : [];
  const answer = typeof output['answer'] === 'string' && output['answer'].trim().length > 0
    ? output['answer'].trim()
    : undefined;
  return { status, blockingReason, evidence, answer };
}

export function routerOutputFromStructuredOutput(output: unknown): ArchitectureRouterOutput | null {
  if (!isRecord(output)) {
    return null;
  }
  const nextAction = output['nextAction'];
  if (
    nextAction !== 'finalize'
    && nextAction !== 'ask_human'
    && nextAction !== 'route_to'
    && nextAction !== 'run_more_research'
    && nextAction !== 'rerun_with_different_personas'
  ) {
    return null;
  }
  const response = typeof output['response'] === 'string' ? output['response'] : undefined;
  const mergedDecision = typeof output['mergedDecision'] === 'string' ? output['mergedDecision'] : response ?? '';
  const targetNodeId = typeof output['targetNodeId'] === 'string' ? output['targetNodeId'] : undefined;
  const selectedStrategy = typeof output['selectedStrategy'] === 'string' ? output['selectedStrategy'] : targetNodeId ?? nextAction;
  const confidence = typeof output['confidence'] === 'number' && Number.isFinite(output['confidence'])
    ? output['confidence']
    : 1;
  return {
    selectedStrategy,
    mergedDecision,
    acceptedInputs: routerInsights(output['acceptedInputs']),
    rejectedInputs: routerInsights(output['rejectedInputs']),
    unresolvedConflicts: stringArray(output['unresolvedConflicts']),
    risks: routerRisks(output['risks']),
    confidence,
    nextAction,
    ...(targetNodeId ? { targetNodeId } : {}),
    ...(response ? { response } : {}),
  };
}

function routerInsights(value: unknown): ArchitectureRouterInsight[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): ArchitectureRouterInsight[] => {
    if (!isRecord(item) || typeof item['fromSlot'] !== 'string' || typeof item['insight'] !== 'string') {
      return [];
    }
    const whyAccepted = typeof item['whyAccepted'] === 'string' ? item['whyAccepted'] : undefined;
    const whyRejected = typeof item['whyRejected'] === 'string' ? item['whyRejected'] : undefined;
    return [{
      fromSlot: item['fromSlot'],
      insight: item['insight'],
      ...(whyAccepted ? { whyAccepted } : {}),
      ...(whyRejected ? { whyRejected } : {}),
    }];
  });
}

function routerRisks(value: unknown): ArchitectureRouterRisk[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): ArchitectureRouterRisk[] => {
    if (
      !isRecord(item)
      || typeof item['risk'] !== 'string'
      || typeof item['mitigation'] !== 'string'
      || typeof item['sourceSlot'] !== 'string'
    ) {
      return [];
    }
    return [{
      risk: item['risk'],
      mitigation: item['mitigation'],
      sourceSlot: item['sourceSlot'],
    }];
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
