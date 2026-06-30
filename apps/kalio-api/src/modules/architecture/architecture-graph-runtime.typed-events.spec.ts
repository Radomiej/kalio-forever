import type { ArchitectureRoleExecutor } from './architecture-role-executor';
import type { ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { createArchitectureGraphEvents } from './architecture-graph-runtime';

describe('createArchitectureGraphEvents typed runtime events', () => {
  it('emits typed terminal evidence and decision for finalizer artifacts', async () => {
    const schema: ArchitectureSchema = {
      id: 'typed-finalizer-runtime',
      name: 'Typed Finalizer Runtime',
      description: 'Schema that finalizes through a role-owned artifact node.',
      version: '0.1.0',
      roleSlots: [{
        id: 'finalizer',
        label: 'Finalizer',
        description: 'Produces the final artifact.',
        slotType: 'finalizer',
        defaultPersonaId: 'synthesizer',
        allowedPersonaTags: ['synthesis'],
        required: true,
        canOverrideAtRunStart: true,
      }],
      nodes: [
        { id: 'final-artifact', label: 'Final Artifact', kind: 'artifact', roleSlotId: 'finalizer' },
      ],
      edges: [],
      routerPolicy: {
        mode: 'evidence_first',
        mustAddressCriticFindings: true,
        canReturnNeedsMoreResearch: true,
      },
      contextPolicy: {
        includeUserTask: true,
        includeProjectMemory: false,
        includeBrowserSession: false,
        includePriorDecisions: false,
      },
      memoryPolicy: {
        persistFinalArtifact: true,
        persistRouterDecision: true,
      },
      outputArtifactSchema: 'runtime-test',
    };
    const run: ArchitectureRun = {
      id: 'run-typed-finalizer-runtime',
      schemaId: schema.id,
      prompt: 'Produce a final artifact.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 5 },
      rootSessionId: 'root-typed-finalizer-runtime',
      branchSessionIds: {
        finalizer: 'arch-run-typed-finalizer-runtime-finalizer',
      },
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(async () => ({
        message: 'Final artifact body.',
        data: {
          artifactId: 'artifact-1',
        },
      })),
    };

    const events = await createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'synthesizer',
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'run_created',
      lifecycle: 'started',
      status: 'running',
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'node_started',
      nodeId: 'final-artifact',
      lifecycle: 'node_started',
      status: 'running',
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'final_artifact',
      nodeId: 'final-artifact',
      roleSlotId: 'finalizer',
      lifecycle: 'done',
      status: 'done',
      reasonCode: 'final_artifact_accepted',
      evidence: [expect.objectContaining({
        kind: 'FINAL_ARTIFACT',
        status: 'passed',
        source: 'finalizer',
        data: expect.objectContaining({
          nodeId: 'final-artifact',
          artifactId: 'artifact-1',
        }),
      })],
      runtimeDecision: expect.objectContaining({
        status: 'done',
        accepted: true,
        reasonCode: 'final_artifact_accepted',
      }),
      data: expect.objectContaining({
        reasonCode: 'final_artifact_accepted',
        runtimeDecision: expect.objectContaining({
          status: 'done',
          accepted: true,
          reasonCode: 'final_artifact_accepted',
        }),
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'node_completed',
      nodeId: 'final-artifact',
      lifecycle: 'node_completed',
      status: 'done',
    }));
  });
});
