import type { ArchitectureExecutionEvent } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import {
  architectureAuditExecutionMode,
  architectureAuditPromptFromRecords,
  statusFromArchitectureAuditEventSummary,
  statusFromArchitectureEvents,
} from './architecture-runtime-audit-recovery.utils';

describe('architecture runtime audit recovery utils', () => {
  it('derives terminal run status from typed event fields', () => {
    expect(statusFromArchitectureEvents([
      architectureEvent({ type: 'router_decision' }),
      architectureEvent({ type: 'final_artifact' }),
    ])).toBe('completed');

    expect(statusFromArchitectureAuditEventSummary([
      { type: 'router_decision', reasonCode: 'max_steps' },
    ])).toBe('failed');

    expect(statusFromArchitectureAuditEventSummary([
      { type: 'node_completed' },
      { type: 'node_started', status: 'cancelled' },
    ])).toBe('cancelled');

    expect(statusFromArchitectureAuditEventSummary([
      { type: 'node_completed' },
    ])).toBe('running');
  });

  it('recovers display prompt and execution mode without parsing runtime status text', () => {
    expect(architectureAuditPromptFromRecords([
      { eventType: 'run_created', prompt: 'Review workflow runtime' },
    ])).toBe('Review workflow runtime');

    expect(architectureAuditPromptFromRecords([
      {
        eventType: 'run_created',
        messagePreview: 'Architecture run created for: Legacy prompt',
      },
    ])).toBe('Legacy prompt');

    expect(architectureAuditExecutionMode({ executionMode: 'subagent_execution' })).toBe('subagent_execution');
    expect(architectureAuditExecutionMode({ executionMode: 'not-valid' })).toBe('session_branches');
  });
});

function architectureEvent(
  overrides: Pick<ArchitectureExecutionEvent, 'type'> & Partial<ArchitectureExecutionEvent>,
): ArchitectureExecutionEvent {
  return {
    id: `${overrides.type}-event`,
    runId: 'run-audit',
    sequence: 1,
    message: overrides.message ?? overrides.type,
    createdAt: 1,
    ...overrides,
  };
}
