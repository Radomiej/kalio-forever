import type { ArchitectureRouterInsight, ArchitectureRouterOutput, ArchitectureRouterRisk } from '@kalio/types';
import { compactArchitectureTraceContent } from './architectureTraceContent';

export function sanitizeRouterOutput(output: ArchitectureRouterOutput | undefined): ArchitectureRouterOutput | undefined {
  if (!output) {
    return undefined;
  }
  return {
    ...output,
    selectedStrategy: compactRouterField(output.selectedStrategy),
    mergedDecision: compactRouterField(output.mergedDecision),
    acceptedInputs: output.acceptedInputs.map(sanitizeRouterInsight),
    rejectedInputs: output.rejectedInputs.map(sanitizeRouterInsight),
    unresolvedConflicts: output.unresolvedConflicts.map(compactRouterField).filter(Boolean),
    risks: output.risks.map(sanitizeRouterRisk),
  };
}

function sanitizeRouterInsight(input: ArchitectureRouterInsight): ArchitectureRouterInsight {
  return {
    ...input,
    insight: compactRouterField(input.insight),
    whyAccepted: input.whyAccepted ? compactRouterField(input.whyAccepted) : undefined,
    whyRejected: input.whyRejected ? compactRouterField(input.whyRejected) : undefined,
  };
}

function sanitizeRouterRisk(risk: ArchitectureRouterRisk): ArchitectureRouterRisk {
  return {
    ...risk,
    risk: compactRouterField(risk.risk),
    mitigation: compactRouterField(risk.mitigation),
  };
}

function compactRouterField(value: string): string {
  return compactArchitectureTraceContent(value, 'router');
}
