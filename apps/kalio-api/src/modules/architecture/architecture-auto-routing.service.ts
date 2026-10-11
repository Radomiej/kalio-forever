import { Inject, Injectable } from '@nestjs/common';
import { DECISION_SETTINGS, type DecisionSettingsPort, type DecisionConnection, type ArchitectureExecutionEvent, type ArchitectureSchemaEdge, type ArchitectureSchemaNode, type ArchitectureSchema } from '@kalio/types';
import { JevDecisionsClient } from '../../common/jev-decisions.client';
import { sanitizeJevState } from '../../common/jev-state-sanitizer';

export type ArchitectureAutoRoutingChoice = {
  edgeId: string;
  source: 'jev_choice' | 'runtime_fallback';
  confidence?: number;
  reason: 'confidence_met' | 'credential_missing' | 'low_confidence' | 'invalid_response' | 'provider_error';
};

export type ArchitectureAutoRoutingInput = {
  schema: ArchitectureSchema;
  node: ArchitectureSchemaNode;
  run: { id: string; prompt: string };
  incomingNodeIds: string[];
  incomingEvents: ArchitectureExecutionEvent[];
  outgoingEdges: ArchitectureSchemaEdge[];
  signal?: AbortSignal;
};

@Injectable()
export class ArchitectureAutoRoutingService {
  constructor(
    @Inject(DECISION_SETTINGS) private readonly decisions: DecisionSettingsPort,
    private readonly jev: JevDecisionsClient,
  ) {}

  async choose(input: ArchitectureAutoRoutingInput): Promise<ArchitectureAutoRoutingChoice> {
    const defaultEdge = input.outgoingEdges.find((edge) => edge.selection === 'default');
    const choiceEdges = input.outgoingEdges.filter((edge) => edge.selection === 'choice');
    if (!defaultEdge || choiceEdges.length === 0 || input.outgoingEdges.filter((edge) => edge.selection === 'default').length !== 1) {
      throw new Error(`Auto-routing node ${input.node.id} has invalid choice/default edges.`);
    }

    const fallback = (reason: ArchitectureAutoRoutingChoice['reason'], confidence?: number): ArchitectureAutoRoutingChoice => ({
      edgeId: defaultEdge.id,
      source: 'runtime_fallback',
      ...(confidence !== undefined ? { confidence } : {}),
      reason,
    });
    try {
      let connection: DecisionConnection;
      try { connection = await this.decisions.resolve(); }
      catch (error) { if (input.signal?.aborted) throw error; return fallback('credential_missing'); }

      const nodesById = new Map(input.schema.nodes.map((node) => [node.id, node]));
      const criteria = Object.fromEntries(choiceEdges.map((edge) => {
        const target = nodesById.get(edge.toNodeId);
        const description = [
          edge.label?.trim(),
          target ? `${target.label} (${target.kind})` : edge.toNodeId,
        ].filter(Boolean).join(' — ');
        return [edge.id, description];
      }));
      const response = await this.jev.decideChoice({
        ...connection,
        questionId: 'next_edge',
        instructions: [
          'Choose the single best next edge for the workflow. Return only one exact edge ID from the choices.',
          input.node.autoRouting?.instructions,
        ].filter(Boolean).join('\n\n').slice(0, 2_500),
        criteria,
        signal: input.signal,
        state: autoRoutingEvidenceState(input),
      });
      const threshold = input.node.autoRouting?.confidenceThreshold ?? 0.8;
      if (response.confidence < threshold) return fallback('low_confidence', response.confidence);
      return { edgeId: response.choice, source: 'jev_choice', confidence: response.confidence, reason: 'confidence_met' };
    } catch (error) {
      if (input.signal?.aborted) throw error;
      return fallback(isInvalidDecision(error) ? 'invalid_response' : 'provider_error');
    }
  }
}

function isInvalidDecision(error: unknown): boolean {
  return error instanceof Error && /invalid (?:choice|probability|response)|missing the requested answer/i.test(error.message);
}

const EVIDENCE_DATA_FIELDS = new Set([
  'id', 'eventId', 'runId', 'nodeId', 'sessionId', 'turnId', 'messageId',
  'toolCallId', 'toolName', 'artifactId', 'exitCode', 'errorCode', 'reasonCode',
  'testCount', 'passedCount', 'failedCount',
]);

function autoRoutingEvidenceState(input: ArchitectureAutoRoutingInput): Record<string, unknown> {
  const matched = input.incomingEvents.filter((event) => !event.nodeId || input.incomingNodeIds.includes(event.nodeId));
  const events = matched.slice(-20).map(projectEvidenceEvent);
  const state = sanitizeJevState({
    task: input.run.prompt,
    node: { id: input.node.id, label: input.node.label },
  });
  const projection = { scope: 'allowlisted_event_evidence', complete: false, matchedEventCount: matched.length, omittedEventCount: matched.length - events.length };
  state['previousEvents'] = events;
  state['evidenceProjection'] = projection;
  const updateCompleteness = () => {
    projection.omittedEventCount = matched.length - events.length;
    projection.complete = projection.omittedEventCount === 0 && events.every((event) => event.evidenceProjection.complete);
  };
  updateCompleteness();
  // Preserve typed identities/statuses rather than falling back to serialized truncatedState.
  while (JSON.stringify(state).length > 12_000 && events.length > 0) {
    const largest = [...events].sort((a, b) => JSON.stringify(b.evidence).length - JSON.stringify(a.evidence).length)
      .find((event) => event.evidence.length > 0);
    if (largest) {
      largest.evidence.pop();
      largest.evidenceProjection.omittedCount += 1;
      largest.evidenceProjection.complete = false;
    } else {
      events.shift();
    }
    updateCompleteness();
  }
  return state;
}

function projectEvidenceEvent(event: ArchitectureExecutionEvent) {
  const rows = event.evidence ?? [];
  let omittedFields = 0;
  let truncated = (event.route?.selectedNodeIds.length ?? 0) > 20;
  const evidence = rows.slice(0, 6).map((row) => {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row.data ?? {})) {
      if (EVIDENCE_DATA_FIELDS.has(key) && (typeof value === 'string' || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value)))) {
        const sanitized = sanitizeJevState({ value })['value'];
        if (typeof sanitized === 'string' && sanitized.length > 256) {
          truncated = true;
          data[key] = sanitized.slice(0, 256);
        } else data[key] = sanitized;
      } else omittedFields += 1;
    }
    return { kind: row.kind, source: row.source, status: row.status, data };
  });
  const projected = sanitizeJevState({
    id: event.id, runId: event.runId, sequence: event.sequence,
    type: event.type, nodeId: event.nodeId, roleSlotId: event.roleSlotId, createdAt: event.createdAt,
    status: event.status, reasonCode: event.reasonCode, errorCode: event.errorCode,
    message: event.message,
    failure: event.failure ? {
      code: event.failure.code, source: event.failure.source,
      retryable: event.failure.retryable, message: event.failure.message,
    } : undefined,
    runtimeDecision: event.runtimeDecision ? {
      status: event.runtimeDecision.status, reasonCode: event.runtimeDecision.reasonCode,
      accepted: event.runtimeDecision.accepted, nextNodeId: event.runtimeDecision.nextNodeId,
      message: event.runtimeDecision.message,
    } : undefined,
    route: event.route ? {
      source: event.route.source, selectedNodeIds: event.route.selectedNodeIds.slice(0, 20),
      decisionReason: event.route.decisionReason,
    } : undefined,
    evidence,
  }, 100_000);
  // Sanitization runs before text limits so a cut credential cannot evade redaction.
  const bound = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') {
      const limit = key === 'message' ? 500 : 256;
      if (value.length > limit || value === '[TRUNCATED]') truncated = true;
      return value.slice(0, limit);
    }
    if (Array.isArray(value)) return value.map((entry) => bound(entry));
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, bound(entryValue, entryKey)]),
    );
    return value;
  };
  const bounded = bound(projected) as Record<string, unknown>;
  // The sanitizer itself caps strings at 2000 before the tighter projection bounds.
  const omittedCount = Math.max(0, rows.length - evidence.length);
  return {
    ...bounded,
    evidence: bounded['evidence'] as Array<Record<string, unknown>>,
    evidenceProjection: {
      complete: omittedCount === 0 && omittedFields === 0 && !truncated,
      originalCount: rows.length, omittedCount, omittedFields, truncated,
    },
  };
}
