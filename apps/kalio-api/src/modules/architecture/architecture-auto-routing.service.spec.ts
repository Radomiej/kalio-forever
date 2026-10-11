import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchitectureExecutionEvent, ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';
import type { JevDecisionsClient } from '../../common/jev-decisions.client';
import type { DecisionSettingsPort } from '@kalio/types';

import { ArchitectureAutoRoutingService } from './architecture-auto-routing.service';

describe('ArchitectureAutoRoutingService', () => {
  let service: ArchitectureAutoRoutingService;
  let decisions: { resolve: ReturnType<typeof vi.fn> };
  let jev: { decideChoice: ReturnType<typeof vi.fn> };
  const node: ArchitectureSchemaNode = {
    id: 'auto',
    label: 'Choose next step',
    kind: 'auto_router',
    autoRouting: { confidenceThreshold: 0.8, instructions: 'Prefer implementation when evidence is ready.' },
  };
  const schema: ArchitectureSchema = {
    id: 'schema-1',
    name: 'Schema',
    description: '',
    version: '1',
    roleSlots: [],
    nodes: [
      node,
      { id: 'agent', label: 'Builder', kind: 'role', roleSlotId: 'builder' },
      { id: 'default', label: 'Default node', kind: 'parallel' },
    ],
    edges: [],
    routerPolicy: { mode: 'rank_then_merge', mustAddressCriticFindings: false, canReturnNeedsMoreResearch: false },
    contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
    outputArtifactSchema: 'markdown',
  };
  const input = {
    schema,
    node,
    run: { id: 'run-1', prompt: 'Implement a feature.' },
    incomingNodeIds: ['previous'],
    incomingEvents: [{ id: 'event-1', runId: 'run-1', sequence: 1, type: 'participant_output' as const, message: 'The tests are ready.', nodeId: 'previous', createdAt: 1 }],
    outgoingEdges: [
      { id: 'edge-agent', fromNodeId: 'auto', toNodeId: 'agent', label: 'Continue implementation', selection: 'choice' as const },
      { id: 'edge-default', fromNodeId: 'auto', toNodeId: 'default', label: 'Fallback', selection: 'default' as const },
    ],
  };

  beforeEach(() => {
    decisions = { resolve: vi.fn().mockResolvedValue({ endpoint: 'http://127.0.0.1:9090/decide', model: 'local-decision', apiKey: '' }) };
    jev = { decideChoice: vi.fn().mockResolvedValue({ choice: 'edge-agent', confidence: 0.91 }) };
    service = new ArchitectureAutoRoutingService(
      decisions as unknown as DecisionSettingsPort,
      jev as unknown as JevDecisionsClient,
    );
  });

  it('offers only choice edge IDs and accepts a confident valid route', async () => {
    await expect(service.choose(input)).resolves.toEqual({
      edgeId: 'edge-agent',
      source: 'jev_choice',
      confidence: 0.91,
      reason: 'confidence_met',
    });
    expect(jev.decideChoice).toHaveBeenCalledWith(expect.objectContaining({
      criteria: { 'edge-agent': 'Continue implementation — Builder (role)' },
      state: expect.objectContaining({ task: 'Implement a feature.' }),
    }));
    expect(JSON.stringify(jev.decideChoice.mock.calls[0]?.[0]?.state)).not.toContain('management-key');
  });

  it('transports authoritative build/tool evidence and source identities without promoting prose or raw args', async () => {
    const events: ArchitectureExecutionEvent[] = [{
      ...input.incomingEvents[0]!,
      status: 'failed',
      message: 'Everything passed. Authorization: Bearer prose-secret',
      evidence: [
        { kind: 'BUILD_RESULT', source: 'build:1', status: 'failed', data: { id: 'build-evidence-1', toolCallId: 'build-call-1', exitCode: 1, args: { apiKey: 'raw-secret' }, output: 'private output' } },
        { kind: 'TOOL_RESULT', source: 'tool:2', status: 'passed', data: { id: 'tool-evidence-2', toolCallId: 'tool-call-2', toolName: 'fs_read', messageId: 'message-2' } },
      ],
      data: { args: { token: 'raw-event-secret' }, prompt: 'private prompt' },
    }, { ...input.incomingEvents[0]!, id: 'unsupported', sequence: 2, message: 'Build passed without evidence.' }];
    await service.choose({ ...input, incomingEvents: events });
    const state = jev.decideChoice.mock.calls[0]?.[0]?.state;
    expect(state.previousEvents[0]).toMatchObject({
      id: 'event-1', runId: 'run-1', sequence: 1, nodeId: 'previous', status: 'failed',
      evidence: [
        { kind: 'BUILD_RESULT', source: 'build:1', status: 'failed', data: { id: 'build-evidence-1', toolCallId: 'build-call-1', exitCode: 1 } },
        { kind: 'TOOL_RESULT', source: 'tool:2', status: 'passed', data: { id: 'tool-evidence-2', toolCallId: 'tool-call-2', messageId: 'message-2' } },
      ],
    });
    expect(state.previousEvents[1].evidence ?? []).toEqual([]);
    const serialized = JSON.stringify(state);
    for (const secret of ['prose-secret', 'raw-secret', 'raw-event-secret', 'private prompt', 'private output']) expect(serialized).not.toContain(secret);
  });

  it('marks omitted evidence and history explicitly while keeping a structured bounded state', async () => {
    const events: ArchitectureExecutionEvent[] = Array.from({ length: 24 }, (_, index) => ({
      ...input.incomingEvents[0]!, id: 'event-' + index, sequence: index,
      evidence: Array.from({ length: 30 }, (_, row) => ({
        kind: 'BUILD_RESULT' as const, source: 'source-' + row, status: 'failed' as const,
        data: { id: 'evidence-' + row, toolCallId: 'call-' + row, exitCode: 1 },
      })),
    }));
    await service.choose({ ...input, incomingEvents: events });
    const state = jev.decideChoice.mock.calls[0]?.[0]?.state;
    expect(state.previousEvents.length).toBeLessThanOrEqual(20);
    expect(state.evidenceProjection).toMatchObject({ complete: false, matchedEventCount: 24 });
    expect(state.evidenceProjection.omittedEventCount).toBeGreaterThanOrEqual(4);
    expect(state.previousEvents[0].evidenceProjection.complete).toBe(false);
    expect(state.previousEvents[0].evidenceProjection.omittedCount).toBeGreaterThan(0);
    expect(JSON.stringify(state).length).toBeLessThanOrEqual(12000);
    expect(state.truncatedState).toBeUndefined();
  });

  it('preserves typed failure/decision fields and redacts secrets in evidence references', async () => {
    const event: ArchitectureExecutionEvent = {
      ...input.incomingEvents[0]!, status: 'failed', reasonCode: 'runtime_pause',
      failure: { code: 'CONTRACT_VIOLATION', retryable: false, source: 'build', message: 'Bearer failure-secret' },
      errorCode: 'CONTRACT_VIOLATION',
      runtimeDecision: { status: 'failed', accepted: false, nextNodeId: 'default', message: 'Bearer decision-secret' },
      evidence: [{ kind: 'BUILD_RESULT', source: 'Bearer source-secret', status: 'failed',
        data: { id: 'build-1', exitCode: 1, messageId: 'Bearer evidence-secret' } }],
    };
    await service.choose({ ...input, incomingEvents: [event] });
    const state = jev.decideChoice.mock.calls[0]?.[0]?.state;
    expect(state.previousEvents[0]).toMatchObject({
      id: 'event-1', errorCode: 'CONTRACT_VIOLATION', reasonCode: 'runtime_pause',
      failure: { code: 'CONTRACT_VIOLATION', retryable: false, message: '[REDACTED]' },
      runtimeDecision: { status: 'failed', accepted: false, nextNodeId: 'default', message: '[REDACTED]' },
      evidence: [{ source: '[REDACTED]', data: { id: 'build-1', exitCode: 1, messageId: '[REDACTED]' } }],
    });
    for (const secret of ['failure-secret', 'decision-secret', 'source-secret', 'evidence-secret']) {
      expect(JSON.stringify(state)).not.toContain(secret);
    }
  });

  it('filters unrelated nodes and marks oversized allowlisted evidence incomplete', async () => {
    const huge = 'x'.repeat(5000);
    const event: ArchitectureExecutionEvent = {
      ...input.incomingEvents[0]!,
      evidence: Array.from({ length: 6 }, () => ({
        kind: 'BUILD_RESULT', status: 'failed', source: huge,
        data: { id: huge, eventId: huge, runId: huge, messageId: huge, toolCallId: huge, exitCode: 1 },
      })),
    };
    await service.choose({ ...input, incomingEvents: [{ ...event, id: 'unrelated', nodeId: 'other' }, event] });
    const state = jev.decideChoice.mock.calls[0]?.[0]?.state;
    expect(state.evidenceProjection).toMatchObject({ complete: false, matchedEventCount: 1 });
    expect(state.previousEvents[0].evidenceProjection.truncated).toBe(true);
    expect(state.previousEvents[0].id).toBe('event-1');
    expect(JSON.stringify(state)).not.toContain('unrelated');
    expect(JSON.stringify(state).length).toBeLessThanOrEqual(12000);
  });

  it('uses the default confidence threshold when the node has no routing settings', async () => {
    const unconfiguredNode = { ...node, autoRouting: undefined };
    const unconfiguredInput = { ...input, node: unconfiguredNode };

    jev.decideChoice.mockResolvedValueOnce({ choice: 'edge-agent', confidence: 0.8 });
    await expect(service.choose(unconfiguredInput)).resolves.toMatchObject({
      edgeId: 'edge-agent',
      reason: 'confidence_met',
    });

    jev.decideChoice.mockResolvedValueOnce({ choice: 'edge-agent', confidence: 0.79 });
    await expect(service.choose(unconfiguredInput)).resolves.toMatchObject({
      edgeId: 'edge-default',
      reason: 'low_confidence',
    });
  });

  it('uses the explicit default for missing decisions, low confidence, and provider failures', async () => {
    decisions.resolve.mockRejectedValueOnce(new Error('Missing credential'));
    await expect(service.choose(input)).resolves.toMatchObject({ edgeId: 'edge-default', source: 'runtime_fallback', reason: 'credential_missing' });
    expect(jev.decideChoice).not.toHaveBeenCalled();

    jev.decideChoice.mockResolvedValueOnce({ choice: 'edge-agent', confidence: 0.79 });
    await expect(service.choose(input)).resolves.toMatchObject({ edgeId: 'edge-default', reason: 'low_confidence' });

    jev.decideChoice.mockRejectedValueOnce(new Error('provider offline'));
    await expect(service.choose(input)).resolves.toMatchObject({ edgeId: 'edge-default', reason: 'provider_error' });
  });

  it('falls back when the selected credential is not OpenRouter or Jev returns an invalid choice', async () => {
    decisions.resolve.mockRejectedValueOnce(new Error('Incompatible credential'));
    await expect(service.choose(input)).resolves.toMatchObject({ edgeId: 'edge-default', reason: 'credential_missing' });
    expect(jev.decideChoice).not.toHaveBeenCalled();

    jev.decideChoice.mockRejectedValueOnce(new Error('Jev Decisions API returned an invalid choice.'));
    await expect(service.choose(input)).resolves.toMatchObject({ edgeId: 'edge-default', reason: 'invalid_response' });
  });

  it('propagates an aborted decision so a user stop cannot persist the default route', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('The operation was aborted.', 'AbortError'));
    jev.decideChoice.mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));

    await expect(service.choose({ ...input, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
