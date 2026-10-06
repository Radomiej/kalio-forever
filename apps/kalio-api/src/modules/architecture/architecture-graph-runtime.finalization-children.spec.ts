import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { createArchitectureGraphEvents } from './architecture-graph-runtime';

const schema: ArchitectureSchema = {
  id: 'child-finalization', name: 'Child finalization', description: 'Finalizer boundary regression', version: '0.1.0',
  roleSlots: ['implementer', 'verifier', 'finalizer'].map(id => ({
    id, label: id, description: id, slotType: id === 'finalizer' ? 'finalizer' : 'tool_executor',
    defaultPersonaId: id, allowedPersonaTags: [], required: true, canOverrideAtRunStart: true,
  })),
  nodes: [{ id: 'final', label: 'Final', kind: 'artifact', roleSlotId: 'finalizer' }],
  edges: [],
  routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
  contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
  memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
  outputArtifactSchema: 'markdown',
};

function evidence(statuses: Array<string | undefined>): ArchitectureExecutionEvent[] {
  return [{
    id: 'implementation', runId: 'child-run', sequence: 1, createdAt: 1,
    type: 'participant_output', roleSlotId: 'implementer', message: 'Delegated implementation',
    data: { toolEvidence: {
      toolResultCount: 1, successfulToolNames: ['spawn_cli_agent'], targetPaths: ['src/main.ts'],
      childCliSessions: statuses.map(status => ({ status })),
    } },
  }, {
    id: 'verification', runId: 'child-run', sequence: 2, createdAt: 2,
    type: 'participant_output', roleSlotId: 'verifier', message: 'Read and build proof',
    data: { toolEvidence: {
      toolResultCount: 2, successfulToolNames: ['fs_read', 'terminal_output'], targetPaths: ['package.json'],
    } },
    evidence: [{ kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 } }],
  }];
}

function fixture(statuses: Array<string | undefined>, gate: 'passed' | 'failed' = 'passed') {
  const run: ArchitectureRun = {
    id: 'child-run', schemaId: schema.id, prompt: 'Complete implementation', executionMode: 'subagent_execution',
    context: { maxArchitectureSteps: 5, externalQualityGate: { source: 'QA', status: gate, highFindings: gate === 'failed' ? 1 : 0 } },
    rootSessionId: 'root', branchSessionIds: { finalizer: 'final-session' },
    status: 'running', createdAt: 100, updatedAt: 100,
  };
  const execute = vi.fn(async () => ({ message: 'Accepted artifact', data: { artifactId: 'artifact' } }));
  const events: ArchitectureExecutionEvent[] = [];
  return {
    execute, events,
    start: () => createArchitectureGraphEvents({
      schema, run, now: 100, priorEvents: evidence(statuses),
      roleExecutor: { execute }, personaForSlot: slot => slot.id,
      onEvent: event => { events.push(event); },
    }),
  };
}

describe('runtime finalizer refuses unresolved implementation children', () => {
  it.each(['running', 'cancelled', 'failed', undefined])('blocks %s despite passed QA and successful read/build', async status => {
    const test = fixture([status]);
    await expect(test.start()).rejects.toThrow(`child status is ${status ?? 'unknown'}`);
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.events.some(event => event.type === 'final_artifact')).toBe(false);
    expect(test.events).toContainEqual(expect.objectContaining({ type: 'node_failed', nodeId: 'final' }));
  });

  it('does not let one completed sibling hide another running child', async () => {
    const test = fixture(['completed', 'running']);
    await expect(test.start()).rejects.toThrow('child status is running');
    expect(test.execute).not.toHaveBeenCalled();
  });

  it.each(['completed', 'terminal-success', 'success', 'exited'])('accepts resolved %s children', async status => {
    const test = fixture([status]);
    const events = await test.start();
    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'final_artifact', reasonCode: 'final_artifact_accepted' }));
  });

  it('keeps failed QA precedence even when every child is complete', async () => {
    const test = fixture(['completed'], 'failed');
    await expect(test.start()).rejects.toThrow('QA quality gate failed');
    expect(test.execute).not.toHaveBeenCalled();
  });
});
