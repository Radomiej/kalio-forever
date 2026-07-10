import type { ArchitectureExecutionEvent, ArchitectureRoleSlot } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import type { ArchitectureBranchStreamSnapshot } from './architecture-stream-hooks';
import {
  architectureRecoverableErrorMessage,
  architectureSlotMessage,
  compactStreamSnapshot,
  incomingEventEvidenceSummary,
  summarizeToolEvidence,
} from './architecture-role-evidence.utils';

function slot(overrides: Partial<ArchitectureRoleSlot> = {}): ArchitectureRoleSlot {
  return {
    id: 'analyst',
    label: 'Analyst',
    description: 'Analyze evidence',
    slotType: 'participant',
    defaultPersonaId: 'analyst-persona',
    allowedPersonaTags: [],
    required: true,
    canOverrideAtRunStart: true,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ArchitectureBranchStreamSnapshot> = {}): ArchitectureBranchStreamSnapshot {
  return {
    streamGroupId: 'architecture:run-1:analyst',
    runId: 'run-1',
    nodeId: 'analyst-node',
    roleSlotId: 'analyst',
    branchSessionId: 'branch-1',
    personaId: 'analyst-persona',
    status: 'completed',
    chunkCount: 2,
    text: 'done',
    events: [],
    ...overrides,
  };
}

function input(slotOverride: Partial<ArchitectureRoleSlot> = {}) {
  return {
    run: { context: { projectPath: 'C:\\Projects\\FamilyQuest' } },
    slot: slot(slotOverride),
  };
}

describe('architecture role evidence helpers', () => {
  it('summarizes tool and CLI child evidence from typed stream events', () => {
    const evidence = summarizeToolEvidence(snapshot({
      events: [
        { sequence: 1, event: 'tool:start', toolName: 'fs_list', toolPath: 'C:\\Projects\\FamilyQuest' },
        { sequence: 2, event: 'tool:result', toolName: 'fs_list', status: 'success' },
        { sequence: 3, event: 'tool:start', toolName: 'fs_read', toolPath: 'C:\\Projects\\FamilyQuest\\package.json' },
        { sequence: 4, event: 'tool:result', toolName: 'fs_read', status: 'failed' },
        {
          sequence: 5,
          event: 'tool:result',
          toolName: 'spawn_cli_agent',
          childSessionId: 'cli-child-1',
          agentId: 'codex',
          workdir: 'C:\\Projects\\FamilyQuest',
          status: 'running',
        },
        {
          sequence: 6,
          event: 'tool:result',
          toolName: 'get_cli_agent_status',
          childSessionId: 'cli-child-1',
          childStatus: 'completed',
        },
      ],
    }));

    expect(evidence).toEqual({
      toolCallCount: 2,
      toolResultCount: 4,
      toolNames: ['fs_list', 'fs_read'],
      successfulToolNames: ['fs_list', 'spawn_cli_agent', 'get_cli_agent_status'],
      targetPaths: ['C:\\Projects\\FamilyQuest', 'C:\\Projects\\FamilyQuest\\package.json'],
      childCliSessions: [{
        childSessionId: 'cli-child-1',
        agentId: 'codex',
        workdir: 'C:\\Projects\\FamilyQuest',
        status: 'completed',
      }],
    });
  });

  it('formats bounded evidence messages with compact project-relative paths', () => {
    const message = architectureSlotMessage(
      input(),
      'raw result',
      {
        toolCallCount: 2,
        toolResultCount: 2,
        toolNames: ['fs_list', 'fs_read'],
        successfulToolNames: ['fs_list'],
        targetPaths: ['C:\\Projects\\FamilyQuest', 'C:\\Projects\\FamilyQuest\\apps\\web\\package.json'],
      },
      true,
    );

    expect(message).toContain('Analyst completed a bounded evidence pass.');
    expect(message).toContain('Evidence: 2 tool result(s), successful=fs_list.');
    expect(message).toContain('Evidence paths: ., apps/web/package.json.');
    expect(message).not.toContain('raw result');
  });

  it('keeps tool executor messages raw even when the bounded loop is exhausted', () => {
    expect(architectureSlotMessage(
      input({ slotType: 'tool_executor', id: 'implementer', label: 'Implementer' }),
      'write completed',
      {
        toolCallCount: 1,
        toolResultCount: 1,
        toolNames: ['vfs_write'],
        successfulToolNames: ['vfs_write'],
        targetPaths: ['architecture.md'],
      },
      true,
    )).toBe('write completed');
  });

  it('formats router handoff from structured output instead of relying on raw assistant prose', () => {
    const message = architectureSlotMessage(
      input({ id: 'orchestrator', label: 'Orchestrator', slotType: 'router' }),
      '',
      {
        toolCallCount: 0,
        toolResultCount: 0,
        toolNames: [],
        successfulToolNames: [],
        targetPaths: [],
      },
      false,
      {
        selectedStrategy: 'backend-first',
        mergedDecision: 'Route backend evidence gathering first.',
        acceptedInputs: [{ fromSlot: 'orchestrator', insight: 'Need backend status proof.', whyAccepted: 'first dependency' }],
        rejectedInputs: [],
        unresolvedConflicts: [],
        risks: [],
        confidence: 0.82,
        nextAction: 'route_to',
        targetNodeId: 'backend',
        response: 'Backend should inspect API workflow runtime status and return concise evidence.',
      },
    );

    expect(message).toContain('Orchestrator handed off to backend.');
    expect(message).toContain('Confidence: 82%.');
    expect(message).toContain('Accepted inputs: 1; rejected inputs: 0.');
    expect(message).toContain('Decision: Route backend evidence gathering first.');
    expect(message).toContain('Handoff: Backend should inspect API workflow runtime status');
    expect(message).toContain('Backend should inspect API workflow runtime status');
  });

  it('formats recoverable branch failures from error objects without changing retry decisions', () => {
    const message = architectureRecoverableErrorMessage(
      input({ id: 'router', label: 'Router', slotType: 'router' }),
      new Error('provider connection reset'),
      {
        toolCallCount: 1,
        toolResultCount: 1,
        toolNames: ['fs_list'],
        successfulToolNames: ['fs_list'],
        targetPaths: ['C:\\Projects\\FamilyQuest\\apps'],
      },
    );

    expect(message).toContain('Router hit a recoverable branch error: provider connection reset.');
    expect(message).toContain('Partial tool evidence: 1 result(s), 1 call(s), successful=fs_list.');
    expect(message).toContain('Evidence paths: apps.');
  });

  it('builds compact stream snapshots without raw text payloads', () => {
    expect(compactStreamSnapshot(snapshot({
      text: 'raw branch transcript should not be copied',
      events: [
        { sequence: 1, event: 'tool:start', toolName: 'fs_list' },
        { sequence: 2, event: 'tool:result', toolName: 'fs_list', status: 'success' },
      ],
    }))).toEqual({
      streamGroupId: 'architecture:run-1:analyst',
      runId: 'run-1',
      nodeId: 'analyst-node',
      roleSlotId: 'analyst',
      branchSessionId: 'branch-1',
      personaId: 'analyst-persona',
      status: 'completed',
      chunkCount: 2,
      toolCallCount: 1,
      toolResultCount: 1,
    });
  });

  it('summarizes typed incoming event evidence for downstream objective context', () => {
    const event: ArchitectureExecutionEvent = {
      id: 'event-1',
      runId: 'run-1',
      sequence: 1,
      type: 'node_completed',
      message: 'done',
      roleSlotId: 'analyst',
      data: {
        incompleteReason: 'max_steps',
        toolEvidence: {
          toolCallCount: 2,
          toolResultCount: 2,
          toolNames: ['fs_list', 'spawn_cli_agent'],
          successfulToolNames: ['fs_list'],
          targetPaths: ['apps/web'],
          childCliSessions: [{ childSessionId: 'cli-child-1', status: 'completed', workdir: 'C:\\Projects\\FamilyQuest' }],
        },
      },
      createdAt: 1_782_518_400_000,
    };

    expect(incomingEventEvidenceSummary(event)).toBe(
      ' [toolEvidence=2 result(s), successful=fs_list, paths=apps/web, childCliSessions=cli-child-1:completed@C:\\Projects\\FamilyQuest; incomplete=max_steps]',
    );
  });
});
