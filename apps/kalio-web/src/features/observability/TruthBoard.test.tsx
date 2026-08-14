import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AuditLogEntry, AuditType } from '@kalio/types';
import { TruthBoard } from './TruthBoard';
import { laneForEntry } from './TruthBoard.model';

function entry(overrides: Partial<AuditLogEntry> & { type: AuditType; label: string }): AuditLogEntry {
  return {
    id: overrides.id ?? `${overrides.type}-${overrides.label}`,
    sessionId: overrides.sessionId ?? null,
    type: overrides.type,
    label: overrides.label,
    data: overrides.data ?? null,
    durationMs: overrides.durationMs ?? null,
    chunkCount: overrides.chunkCount ?? null,
    createdAt: overrides.createdAt ?? 1,
  };
}

describe('TruthBoard', () => {
  it('uses a quiet hierarchy instead of equal bordered cards for every metric', () => {
    render(<TruthBoard entries={[]} />);

    expect(screen.getByTestId('truth-overview-sessions')).not.toHaveClass('border');
    expect(screen.getByTestId('truth-lane-llm')).not.toHaveClass('border');
    expect(screen.getByTestId('truth-lane-llm')).toHaveClass('text-left');
  });

  it('routes typed runtime events to stable observability lanes', () => {
    expect(laneForEntry(entry({
      type: 'runtime_event',
      label: 'workflow.node.started',
      data: { eventName: 'workflow.node.started' },
    }))).toBe('architecture');
    expect(laneForEntry(entry({
      type: 'runtime_event',
      label: 'llm.turn.completed',
      data: { eventName: 'llm.turn.completed' },
    }))).toBe('llm');
    expect(laneForEntry(entry({
      type: 'runtime_event',
      label: 'tool.confirmation.requested',
      data: { eventName: 'tool.confirmation.requested' },
    }))).toBe('hooks');
  });

  it('summarizes architecture runs, subagent children, and omitted tool paths', () => {
    render(
      <TruthBoard
        entries={[
          entry({ type: 'llm_request', label: 'prompt', createdAt: 1 }),
          entry({ type: 'tool_result', label: 'fs_list', data: { omitted: 7 }, createdAt: 2 }),
          entry({
            type: 'tool_result',
            label: 'run_subagent',
            data: { subagent: { childSessionId: 'child-session-12345' } },
            createdAt: 3,
          }),
          entry({
            type: 'tool_result',
            label: 'architecture:five-minds:run-abcdef12345',
            data: {
              kind: 'architecture_runtime',
              runId: 'run-abcdef12345',
              branchSessionIds: { strategist: 's1', reviewer: 's2' },
            },
            createdAt: 4,
          }),
        ]}
      />,
    );

    expect(screen.getByText('runs run-abcd... / 2 branches')).toBeTruthy();
    expect(screen.getByText('1 child session / child-se...')).toBeTruthy();
    expect(screen.getByText('1 VFS/file events / 1 calls/results / 7 omitted paths')).toBeTruthy();
    expect(screen.getByText('Latest: Tool Result / architecture run-abcd')).toBeTruthy();
  });

  it('uses architectureRunId for latest architecture events when runId is absent', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'tool_call',
            label: 'router_dispatch',
            data: {
              architectureRunId: 'run-five-minds-12345',
              nodeId: 'strategist',
            },
            createdAt: 1,
          }),
        ]}
      />,
    );

    expect(screen.getByText('runs run-five...')).toBeTruthy();
    expect(screen.getByText('Latest: Tool Call / architecture run-five')).toBeTruthy();
  });

  it('surfaces LLM token usage in the summary and latest label', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'llm_request',
            label: 'request-1',
            data: {
              estimatedInputTokens: 1200,
            },
            createdAt: 1,
          }),
          entry({
            type: 'llm_response',
            label: 'response-1',
            data: {
              usage: {
                promptTokens: 1500,
                completionTokens: 300,
                totalTokens: 1800,
              },
            },
            createdAt: 2,
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-llm').textContent).toContain('tok 1.8k');
    expect(screen.getByTestId('truth-lane-llm').textContent).toContain('1.5k in / 300 out');
    expect(screen.getByText('response-1 / tok 1.8k (1.5k in / 300 out)')).toBeTruthy();
  });

  it('uses request and response estimates when provider usage is unavailable', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'llm_request',
            label: 'request-1',
            data: {
              estimatedInputTokens: 1200,
            },
            createdAt: 1,
          }),
          entry({
            type: 'llm_response',
            label: 'response-1',
            data: {
              estimatedOutputTokens: 300,
            },
            createdAt: 2,
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-llm').textContent).toContain('tok 1.5k');
    expect(screen.getByTestId('truth-lane-llm').textContent).toContain('1.2k in / 300 out');
  });

  it('shows architecture runtime event counts and lane status as truth evidence', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'tool_result',
            label: 'architecture:five-minds:run-abcdef12345',
            data: {
              kind: 'architecture_runtime',
              runId: 'run-abcdef12345',
              eventCount: 9,
              branchSessionIds: {
                pragmatist: 's1',
                innovator: 's2',
                analyst: 's3',
                user_advocate: 's4',
                devil_advocate: 's5',
              },
            },
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-architecture').textContent).toContain('active');
    expect(screen.getByText('runs run-abcd... / 5 branches / 9 runtime events')).toBeTruthy();
    expect(screen.getByTestId('truth-lane-errors').textContent).toContain('clear');
  });

  it('summarizes architecture hydration audit evidence', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'tool_result',
            label: 'architecture_hydration:run-abcdef12345',
            data: {
              kind: 'architecture_hydration',
              runId: 'run-abcdef12345',
              copiedCount: 2,
              skippedCount: 1,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText('runs run-abcd... / 2 hydrated files / 1 skipped')).toBeTruthy();
  });

  it('prefers normalized audit domains for VFS and subagent summaries', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'tool_call',
            label: 'whatever_wrapper',
            data: {
              kind: 'file_tool_call',
              domain: 'vfs',
              fileTool: { toolName: 'vfs_list' },
            },
            createdAt: 1,
          }),
          entry({
            type: 'tool_result',
            label: 'whatever_wrapper',
            data: {
              kind: 'file_tool_result',
              domain: 'vfs',
              fileTool: { toolName: 'vfs_list', fileCount: 4 },
            },
            createdAt: 2,
          }),
          entry({
            type: 'tool_result',
            label: 'custom_delegate',
            data: {
              kind: 'subagent_tool_result',
              domain: 'subagent',
              subagent: {
                childSessionId: 'child-normalized-12345',
                vfsMode: 'shared',
              },
            },
            createdAt: 3,
          }),
        ]}
      />,
    );

    expect(screen.getByText('2 VFS/file events / 4 files listed / 2 calls/results')).toBeTruthy();
    expect(screen.getByText('1 child session / child-no... / VFS shared')).toBeTruthy();
  });

  it('keeps architecture-scoped file tools in the architecture truth lane', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'tool_result',
            label: 'architecture:five-minds:run-five-minds-12345',
            data: {
              kind: 'architecture_runtime',
              runId: 'run-five-minds-12345',
              eventCount: 9,
              branchSessionIds: {
                pragmatist: 's1',
                innovator: 's2',
                analyst: 's3',
                user_advocate: 's4',
                devil_advocate: 's5',
                synthesizer: 's6',
                finalizer: 's7',
              },
            },
            createdAt: 1,
          }),
          entry({
            type: 'tool_call',
            label: 'vfs_read',
            data: {
              kind: 'file_tool_call',
              domain: 'architecture',
              architectureRunId: 'run-five-minds-12345',
              childAgentRunId: 'subagent-1',
              fileTool: { toolName: 'vfs_read', path: 'project/README.md' },
            },
            createdAt: 2,
          }),
          entry({
            type: 'tool_result',
            label: 'vfs_read',
            data: {
              kind: 'file_tool_result',
              domain: 'architecture',
              architectureRunId: 'run-five-minds-12345',
              childAgentRunId: 'subagent-1',
              fileTool: { toolName: 'vfs_read', path: 'project/README.md' },
            },
            createdAt: 3,
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-architecture').textContent).toContain('3');
    expect(screen.getByText('runs run-five... / 7 branches / 9 runtime events / 2 file tool events / 1 child run')).toBeTruthy();
    expect(screen.getByTestId('truth-lane-tools').textContent).toContain('0');
  });

  it('counts architecture runtime events as first-class architecture evidence', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'tool_result',
            label: 'architecture_event:router_decision:router',
            data: {
              kind: 'architecture_event',
              runId: 'run-five-minds-12345',
              eventType: 'router_decision',
              nodeId: 'router',
              route: { targetNodeId: 'final-artifact' },
            },
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-architecture').textContent).toContain('1');
    expect(screen.getByText('runs run-five... / 1 event row')).toBeTruthy();
    expect(screen.getByText('router_decision / router')).toBeTruthy();
  });

  it('shows architecture lifecycle event breakdown in the truth board', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'architecture_event',
            label: 'architecture_event:node_started:router',
            data: { kind: 'architecture_event', runId: 'run-five-minds-12345', eventType: 'node_started', nodeId: 'router' },
            createdAt: 1,
          }),
          entry({
            type: 'architecture_event',
            label: 'architecture_event:agent_started:router',
            data: { kind: 'architecture_event', runId: 'run-five-minds-12345', eventType: 'agent_started', nodeId: 'router' },
            createdAt: 2,
          }),
          entry({
            type: 'architecture_event',
            label: 'architecture_event:router_output:router',
            data: { kind: 'architecture_event', runId: 'run-five-minds-12345', eventType: 'router_output', nodeId: 'router' },
            createdAt: 3,
          }),
          entry({
            type: 'architecture_event',
            label: 'architecture_event:final_artifact:final-artifact',
            data: { kind: 'architecture_event', runId: 'run-five-minds-12345', eventType: 'final_artifact', nodeId: 'final-artifact' },
            createdAt: 4,
          }),
          entry({
            type: 'architecture_event',
            label: 'architecture_event:node_completed:final-artifact',
            data: { kind: 'architecture_event', runId: 'run-five-minds-12345', eventType: 'node_completed', nodeId: 'final-artifact' },
            createdAt: 5,
          }),
        ]}
      />,
    );

    const text = screen.getByTestId('truth-lane-architecture').textContent ?? '';
    expect(text).toContain('node_started:1');
    expect(text).toContain('agent_started:1');
    expect(text).toContain('router_output:1');
    expect(text).toContain('final_artifact:1');
    expect(text).toContain('node_completed:1');
    expect(text).toContain('5 event rows');
  });

  it('shows architecture tool proof names in the truth board summary', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'architecture_event',
            label: 'architecture_event:participant_output:materializer',
            data: {
              kind: 'architecture_event',
              runId: 'run-five-minds-12345',
              eventType: 'participant_output',
              nodeId: 'materializer',
              toolEvidence: {
                toolResultCount: 2,
                successfulToolNames: ['vfs_write', 'vfs_read'],
              },
            },
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-architecture').textContent).toContain('proof vfs_write, vfs_read');
  });

  it('classifies drifted architecture rows from schema, node, and event identifiers', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'tool_result',
            label: 'router_dispatch',
            data: {
              schemaId: 'five-minds-council',
              runId: 'run-five-minds-12345',
              eventType: 'router_decision',
              nodeId: 'router',
            },
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-architecture').textContent).toContain('1');
    expect(screen.getByTestId('truth-lane-tools').textContent).toContain('0');
  });

  it('classifies architecture-scoped run_subagent calls as subagent evidence', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'tool_call',
            label: 'run_subagent',
            data: {
              kind: 'subagent_tool_call',
              domain: 'subagent',
              architectureRunId: 'run-five-minds-12345',
              subagent: {
                childSessionId: 'child-session-12345',
                vfsMode: 'shared',
              },
            },
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-subagents').textContent).toContain('1');
    expect(screen.getByTestId('truth-lane-architecture').textContent).toContain('0');
  });

  it('classifies drifted subagent rows from child identifiers', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'tool_result',
            label: 'delegate_result',
            data: {
              childSessionId: 'child-session-12345',
              childAgentRunId: 'child-run-12345',
            },
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-subagents').textContent).toContain('1');
    expect(screen.getByTestId('truth-lane-tools').textContent).toContain('0');
  });

  it('shows RA-App HITL lifecycle rows in the Hooks/HITL lane', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'external_hitl',
            label: 'raapp:timeout vfs_write',
            data: {
              domain: 'hitl',
              kind: 'raapp_hitl_lifecycle',
              eventType: 'raapp_approval_timeout',
              approvalKind: 'raapp_native',
              approvalId: 'approval-1',
              toolCallId: 'tool-1',
              system: 'vfs_write',
              timeoutMs: 600_000,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-hooks').textContent).toContain('1');
    expect(screen.getByText('Latest: External HITL / raapp:timeout vfs_write')).toBeTruthy();
  });

  it('classifies drifted HITL rows from approval metadata', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'tool_result',
            label: 'approval_pending',
            data: {
              approvalId: 'approval-1',
              approvalKind: 'human_gate',
            },
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-hooks').textContent).toContain('1');
    expect(screen.getByTestId('truth-lane-tools').textContent).toContain('0');
  });

  it('classifies HITL rows by explicit domain even when labels are generic', () => {
    render(
      <TruthBoard
        entries={[
          entry({
            type: 'tool_result',
            label: 'policy_callback',
            data: {
              domain: 'hitl',
              eventType: 'external_security_approved',
              approvalKind: 'external_security',
              approvalId: 'policy-1',
            },
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('truth-lane-hooks').textContent).toContain('1');
    expect(screen.getByTestId('truth-lane-tools').textContent).toContain('0');
  });
});
