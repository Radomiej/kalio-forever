import type {
  ArchitectureRouteDecision,
  ArchitectureRouterOutput,
  ArchitectureSchema,
  ArchitectureSchemaNode,
} from '@kalio/types';

export function createArchitectureRouterOutput(params: {
  schema: ArchitectureSchema;
  node: ArchitectureSchemaNode;
  incomingNodeIds: string[];
  route: ArchitectureRouteDecision;
  message: string;
  data: Record<string, unknown>;
}): ArchitectureRouterOutput {
  const supplied = params.data['routerOutput'];
  if (isRouterOutput(supplied)) {
    return supplied;
  }
  const parsed = parseRouterOutputFromText(params.message);
  if (parsed) {
    return parsed;
  }

  const selectedStrategy = params.route.nextNodeId ?? params.route.selectedNodeIds[0] ?? 'end';
  const policy = params.schema.routerPolicy;
  const rejectedNodeIds = params.route.rejectedNodeIds ?? [];
  const rejectedInputs = rejectedNodeIds.map((fromSlot) => ({
    fromSlot,
    insight: `Route candidate ${nodeLabel(params.schema, fromSlot)}`,
    whyRejected: `${params.node.label} did not select this route.`,
  }));
  const criticInputIds = params.incomingNodeIds.filter((nodeId) => isCriticNode(params.schema, nodeId));
  const unresolvedConflicts = rejectedNodeIds.map((nodeId) =>
    `${params.node.label} rejected route candidate ${nodeLabel(params.schema, nodeId)} while selecting ${nodeLabel(params.schema, selectedStrategy)}.`,
  );
  const risks = policy.mustAddressCriticFindings
    ? criticInputIds.map((nodeId) => ({
        risk: `Critic input from ${nodeLabel(params.schema, nodeId)} must be addressed before the decision is treated as stable.`,
        mitigation: `Have ${params.node.label} explicitly accept, reject, or escalate ${nodeLabel(params.schema, nodeId)} findings.`,
        sourceSlot: nodeId,
      }))
    : [];
  const nextAction = unresolvedConflicts.length > 0
    ? (policy.canReturnNeedsMoreResearch ? 'run_more_research' : 'ask_human')
    : selectedStrategy === 'end'
      ? 'ask_human'
      : 'finalize';
  const confidence = Math.max(
    0.1,
    Math.min(1, (params.route.source === 'agent' ? 0.7 : 0.55) - (unresolvedConflicts.length > 0 ? 0.15 : 0)),
  );
  return {
    selectedStrategy,
    mergedDecision: typeof params.data['response'] === 'string' && params.data['response'].length > 0
      ? params.data['response']
      : params.message,
    acceptedInputs: params.incomingNodeIds.map((fromSlot) => ({
      fromSlot,
      insight: `Input from ${nodeLabel(params.schema, fromSlot)}`,
      whyAccepted: `${params.node.label} routed this input toward ${selectedStrategy}.`,
    })),
    rejectedInputs,
    unresolvedConflicts,
    risks,
    confidence,
    nextAction,
  };
}

function parseRouterOutputFromText(text: string): ArchitectureRouterOutput | null {
  const candidates = [
    ...extractFencedJsonBlocks(text),
    ...extractTaggedJsonBlocks(text, 'routerOutput'),
    ...extractTaggedJsonBlocks(text, 'router_output'),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRouterOutput(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function extractFencedJsonBlocks(text: string): string[] {
  return [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]?.trim() ?? '');
}

function extractTaggedJsonBlocks(text: string, tag: string): string[] {
  const tagIndex = text.indexOf(tag);
  if (tagIndex < 0) {
    return [];
  }
  const braceIndex = text.indexOf('{', tagIndex);
  if (braceIndex < 0) {
    return [];
  }
  const block = balancedJsonObject(text, braceIndex);
  return block ? [block] : [];
}

function balancedJsonObject(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }
  return null;
}

function nodeLabel(schema: ArchitectureSchema, nodeId: string): string {
  return schema.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function isCriticNode(schema: ArchitectureSchema, nodeId: string): boolean {
  const node = schema.nodes.find((candidate) => candidate.id === nodeId);
  const slot = schema.roleSlots.find((candidate) => candidate.id === node?.roleSlotId);
  return slot?.slotType === 'critic';
}

function isRouterOutput(value: unknown): value is ArchitectureRouterOutput {
  if (!isRecord(value)) {
    return false;
  }
  const nextAction = value['nextAction'];
  return typeof value['selectedStrategy'] === 'string'
    && typeof value['mergedDecision'] === 'string'
    && Array.isArray(value['acceptedInputs'])
    && Array.isArray(value['rejectedInputs'])
    && Array.isArray(value['unresolvedConflicts'])
    && Array.isArray(value['risks'])
    && typeof value['confidence'] === 'number'
    && value['confidence'] >= 0
    && value['confidence'] <= 1
    && (
      nextAction === 'finalize'
      || nextAction === 'ask_human'
      || nextAction === 'run_more_research'
      || nextAction === 'rerun_with_different_personas'
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
