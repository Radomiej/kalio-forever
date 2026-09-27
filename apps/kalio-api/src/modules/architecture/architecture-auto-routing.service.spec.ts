import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';
import type { JevDecisionsClient } from '../../common/jev-decisions.client';
import type { CredentialsService } from '../credentials/credentials.service';
import type { HitlConfigService } from '../hitl/hitl-config.service';
import { ArchitectureAutoRoutingService } from './architecture-auto-routing.service';

describe('ArchitectureAutoRoutingService', () => {
  let service: ArchitectureAutoRoutingService;
  let hitlConfig: { getConfig: ReturnType<typeof vi.fn> };
  let credentials: { getProviderConfigForCredential: ReturnType<typeof vi.fn> };
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
    hitlConfig = { getConfig: vi.fn().mockResolvedValue({ jevCredentialId: 'openrouter-management' }) };
    credentials = { getProviderConfigForCredential: vi.fn().mockResolvedValue({ provider: 'openrouter', apiKey: 'management-key' }) };
    jev = { decideChoice: vi.fn().mockResolvedValue({ choice: 'edge-agent', confidence: 0.91 }) };
    service = new ArchitectureAutoRoutingService(
      hitlConfig as unknown as HitlConfigService,
      credentials as unknown as CredentialsService,
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

  it('uses the explicit default for missing credentials, low confidence, and provider failures', async () => {
    hitlConfig.getConfig.mockResolvedValueOnce({ jevCredentialId: null });
    await expect(service.choose(input)).resolves.toMatchObject({ edgeId: 'edge-default', source: 'runtime_fallback', reason: 'credential_missing' });
    expect(jev.decideChoice).not.toHaveBeenCalled();

    jev.decideChoice.mockResolvedValueOnce({ choice: 'edge-agent', confidence: 0.79 });
    await expect(service.choose(input)).resolves.toMatchObject({ edgeId: 'edge-default', reason: 'low_confidence' });

    jev.decideChoice.mockRejectedValueOnce(new Error('provider offline'));
    await expect(service.choose(input)).resolves.toMatchObject({ edgeId: 'edge-default', reason: 'provider_error' });
  });

  it('falls back when the selected credential is not OpenRouter or Jev returns an invalid choice', async () => {
    credentials.getProviderConfigForCredential.mockResolvedValueOnce({ provider: 'openai', apiKey: 'secret' });
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
