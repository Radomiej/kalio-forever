import { Injectable } from '@nestjs/common';
import type { ArchitectureExecutionEvent, ArchitectureSchemaEdge, ArchitectureSchemaNode, ArchitectureSchema } from '@kalio/types';
import { JevDecisionsClient } from '../../common/jev-decisions.client';
import { sanitizeJevState } from '../../common/jev-state-sanitizer';
import { CredentialsService } from '../credentials/credentials.service';
import { HitlConfigService } from '../hitl/hitl-config.service';

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
    private readonly hitlConfig: HitlConfigService,
    private readonly credentials: CredentialsService,
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
      const config = await this.hitlConfig.getConfig();
      const credentialId = config.jevCredentialId;
      if (!credentialId) return fallback('credential_missing');
      const providerConfig = await this.credentials.getProviderConfigForCredential(credentialId);
      if (!providerConfig || providerConfig.provider !== 'openrouter' || !providerConfig.apiKey.trim()) {
        return fallback('credential_missing');
      }

      const nodesById = new Map(input.schema.nodes.map((node) => [node.id, node]));
      const criteria = Object.fromEntries(choiceEdges.map((edge) => {
        const target = nodesById.get(edge.toNodeId);
        const description = [
          edge.label?.trim(),
          target ? `${target.label} (${target.kind})` : edge.toNodeId,
        ].filter(Boolean).join(' — ');
        return [edge.id, description];
      }));
      const incomingEvents = input.incomingEvents
        .filter((event) => !event.nodeId || input.incomingNodeIds.includes(event.nodeId))
        .slice(-20)
        .map((event) => ({
          type: event.type,
          nodeId: event.nodeId,
          message: event.message.slice(0, 500),
          route: event.route ? {
            source: event.route.source,
            selectedNodeIds: event.route.selectedNodeIds,
            decisionReason: event.route.decisionReason,
          } : undefined,
        }));
      const response = await this.jev.decideChoice({
        apiKey: providerConfig.apiKey,
        questionId: 'next_edge',
        instructions: [
          'Choose the single best next edge for the workflow. Return only one exact edge ID from the choices.',
          input.node.autoRouting?.instructions,
        ].filter(Boolean).join('\n\n').slice(0, 2_500),
        criteria,
        signal: input.signal,
        state: sanitizeJevState({
          task: input.run.prompt,
          node: { id: input.node.id, label: input.node.label },
          previousEvents: incomingEvents,
        }),
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
