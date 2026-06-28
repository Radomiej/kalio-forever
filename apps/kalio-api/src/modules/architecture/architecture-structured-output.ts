import type { ArchitectureRouterOutput } from '@kalio/types';
import {
  parseFinalArtifactContract,
  type ArchitectureFinalArtifactContract,
} from './architecture-final-artifact-contract';
import { parseRouterOutputFromText } from './architecture-router-output';

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

export function legacyTextRouteToCall(message: string): ArchitectureRouteDecision | null {
  const routerOutput = parseRouterOutputFromText(message);
  if (!routerOutput || routerOutput.nextAction !== 'route_to') {
    return null;
  }
  const targetNodeId = routerOutput.targetNodeId?.trim();
  if (!targetNodeId || !/^[A-Za-z0-9_.:-]+$/.test(targetNodeId)) {
    return null;
  }
  const explicitResponse = typeof routerOutput.response === 'string' && routerOutput.response.trim().length > 0
    ? routerOutput.response.trim()
    : undefined;
  const mergedDecision = routerOutput.mergedDecision.trim().length > 0
    ? routerOutput.mergedDecision.trim()
    : undefined;

  return {
    targetNodeId,
    response: explicitResponse ?? mergedDecision,
    routerOutput,
  };
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
  return { status, blockingReason, evidence };
}

export function finalArtifactContractFromLegacyText(message: string): ArchitectureFinalArtifactContract | null {
  return parseFinalArtifactContract(message);
}

function routerOutputFromStructuredOutput(output: unknown): ArchitectureRouterOutput | null {
  if (!isRecord(output) || output['nextAction'] !== 'route_to') {
    return null;
  }
  const targetNodeId = typeof output['targetNodeId'] === 'string' ? output['targetNodeId'] : undefined;
  if (!targetNodeId) {
    return null;
  }
  const response = typeof output['response'] === 'string' ? output['response'] : undefined;
  const mergedDecision = typeof output['mergedDecision'] === 'string' ? output['mergedDecision'] : response ?? '';
  const selectedStrategy = typeof output['selectedStrategy'] === 'string' ? output['selectedStrategy'] : targetNodeId;
  const confidence = typeof output['confidence'] === 'number' && Number.isFinite(output['confidence'])
    ? output['confidence']
    : 1;
  return {
    selectedStrategy,
    mergedDecision,
    acceptedInputs: [],
    rejectedInputs: [],
    unresolvedConflicts: [],
    risks: [],
    confidence,
    nextAction: 'route_to',
    targetNodeId,
    ...(response ? { response } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
