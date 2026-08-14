import { describe, expect, it } from 'vitest';
import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema, WorkflowFailure } from '@kalio/types';
import { architectureFailureRuntimeAuditEventInput, architectureRuntimeAuditEventInput } from './architecture-runtime-audit';

const schema: ArchitectureSchema = {
  id: 'strategic-decision-council',
  name: 'Strategic Decision Council',
  description: 'Runtime audit test schema',
  version: '0.1.0',
  roleSlots: [],
  nodes: [],
  edges: [],
  routerPolicy: {
    mode: 'rank_then_merge',
    mustAddressCriticFindings: true,
    canReturnNeedsMoreResearch: false,
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
  outputArtifactSchema: 'markdown',
};

const run: ArchitectureRun = {
  id: 'run-1',
  schemaId: schema.id,
  prompt: 'raw user prompt must not be copied into runtime audit data',
  executionMode: 'subagent_execution',
  rootSessionId: 'session-1',
  branchSessionIds: { pragmatist: 'child-1' },
  status: 'running',
  createdAt: 1,
  updatedAt: 2,
};

function event(overrides: Partial<ArchitectureExecutionEvent>): ArchitectureExecutionEvent {
  return {
    id: 'event-1',
    runId: run.id,
    sequence: 1,
    type: 'node_started',
    message: 'display text must not drive or pollute runtime audit data',
    createdAt: 3,
    ...overrides,
  };
}

describe('architectureRuntimeAuditEventInput', () => {
  it('maps final artifacts to typed completed runtime events without prompt or message text', () => {
    const input = architectureRuntimeAuditEventInput(schema, run, event({
      type: 'final_artifact',
      nodeId: 'finalizer',
      message: 'Final artifact display message',
    }), 'session-1');

    expect(input).toMatchObject({
      eventName: 'workflow.run.completed',
      sessionId: 'session-1',
      runId: 'run-1',
      nodeId: 'finalizer',
      status: 'completed',
      data: {
        schemaId: 'strategic-decision-council',
        eventType: 'final_artifact',
      },
    });
    expect(input?.data).not.toHaveProperty('prompt');
    expect(input?.data).not.toHaveProperty('message');
  });

  it('marks typed max-step router decisions as failed without parsing display text', () => {
    const input = architectureRuntimeAuditEventInput(schema, run, event({
      type: 'router_decision',
      nodeId: 'router',
      message: 'Router says continue in plain language',
      data: { reasonCode: 'max_steps' },
    }), 'session-1');

    expect(input).toMatchObject({
      eventName: 'workflow.run.failed',
      status: 'failed',
      data: {
        eventType: 'router_decision',
      },
    });
  });
});

describe('architectureFailureRuntimeAuditEventInput', () => {
  it('summarizes workflow failures with typed code and branch count', () => {
    const failure: WorkflowFailure = {
      code: 'CONTRACT_VIOLATION',
      source: 'runtime',
      retryable: false,
      message: 'Structured output did not match schema',
    };

    expect(architectureFailureRuntimeAuditEventInput(schema, run, failure, 'session-1')).toMatchObject({
      eventName: 'workflow.run.failed',
      sessionId: 'session-1',
      runId: 'run-1',
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
      data: {
        schemaId: 'strategic-decision-council',
        branchSessionCount: 1,
        failure: {
          code: 'CONTRACT_VIOLATION',
          source: 'runtime',
          retryable: false,
        },
      },
    });
  });
});
