import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectRunProjection } from './ArchitectRunProjection';
import type { ArchitectRunResult, ArchitectSchema } from './architect.types';

describe('ArchitectRunProjection', () => {
  it('shows the Goal Guard waiting state and submits structured QA evidence back into the flow', async () => {
    const user = userEvent.setup();
    const onResumeWithQualityGate = vi.fn();
    render(
      <ArchitectRunProjection
        activeTab="events"
        onTabChange={vi.fn()}
        run={makeWaitingRun()}
        schema={baseSchema}
        onResumeWithQualityGate={onResumeWithQualityGate}
      />,
    );

    expect(screen.getByText('waiting_on_orchestrator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resume with QA evidence/i })).toBeInTheDocument();
    expect(screen.queryByText(/Five Minds/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Resume with QA evidence/i }));
    await user.clear(screen.getByLabelText('Summary'));
    await user.type(screen.getByLabelText('Summary'), 'QA still finds a blocking issue.');
    await user.clear(screen.getByLabelText('High'));
    await user.type(screen.getByLabelText('High'), '2');
    await user.type(screen.getByLabelText('Artifact path'), 'C:\\qa\\flow.png');
    await user.click(screen.getByTestId('agentflow-resume-with-qa'));

    expect(onResumeWithQualityGate).toHaveBeenCalledWith({
      source: 'playwright',
      status: 'failed',
      highFindings: 2,
      summary: 'QA still finds a blocking issue.',
      artifactPath: 'C:\\qa\\flow.png',
    });
  });

  it('renders completed run metadata without the QA resume affordance', () => {
    render(
      <ArchitectRunProjection
        activeTab="editor"
        onTabChange={vi.fn()}
        run={makeRun({ run: { status: 'completed' } })}
        schema={baseSchema}
      />,
    );

    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('flow-run-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resume with QA evidence/i })).not.toBeInTheDocument();
  });

  it('renders graph projection node counts and executed route hops', () => {
    render(
      <ArchitectRunProjection
        activeTab="graph"
        onTabChange={vi.fn()}
        run={makeRun({
          graph: {
            runId: 'flow-run-1',
            nodes: [
              { id: 'implementer', label: 'Implementer', kind: 'role', status: 'completed', eventIds: ['event-1'] },
              { id: 'goal-guard', label: 'Goal Guard', kind: 'router', status: 'pending', eventIds: [] },
            ],
            edges: [
              { id: 'implementer-goal-guard', fromNodeId: 'implementer', toNodeId: 'goal-guard' },
            ],
            routeHops: [
              {
                eventId: 'event-1',
                source: 'agent',
                fromNodeId: 'implementer',
                toNodeId: 'goal-guard',
              },
            ],
          },
        })}
        schema={baseSchema}
      />,
    );

    expect(screen.getByTestId('architect-graph-status')).toHaveTextContent('Implementer');
    expect(screen.getByTestId('architect-graph-status')).toHaveTextContent('Goal Guard');
    expect(screen.getByTestId('architect-graph-status')).toHaveTextContent('1 events');
    expect(screen.getByTestId('architect-graph-status')).toHaveTextContent('0 events');
    expect(screen.getByTestId('architect-executed-route')).toHaveTextContent('implementer -> goal-guard');
  });

  it('highlights the active running graph node', () => {
    render(
      <ArchitectRunProjection
        activeTab="graph"
        onTabChange={vi.fn()}
        run={makeRun({
          graph: {
            runId: 'flow-run-1',
            nodes: [
              { id: 'orchestrator', label: 'Orchestrator', kind: 'router', status: 'running', eventIds: ['event-1'] },
              { id: 'implementer', label: 'Implementer', kind: 'role', status: 'pending', eventIds: [] },
            ],
            edges: [
              { id: 'orchestrator-implementer', fromNodeId: 'orchestrator', toNodeId: 'implementer' },
            ],
            routeHops: [],
          },
        })}
        schema={baseSchema}
      />,
    );

    expect(screen.getByTestId('architect-projection-node-orchestrator')).toHaveClass('border-sky-400/50');
    expect(screen.getByTestId('architect-projection-node-orchestrator')).toHaveTextContent('running');
  });

  it('shows how many times each runtime node was invoked in the current run', () => {
    render(
      <ArchitectRunProjection
        activeTab="graph"
        onTabChange={vi.fn()}
        run={makeRun({
          graph: {
            runId: 'flow-run-1',
            nodes: [
              {
                id: 'goal-guard',
                label: 'Goal Guard',
                kind: 'router',
                status: 'running',
                eventIds: ['event-1', 'event-2', 'event-3'],
              },
            ],
            edges: [],
            routeHops: [],
          },
        })}
        schema={baseSchema}
      />,
    );

    expect(screen.getByTestId('architect-projection-node-goal-guard')).toHaveTextContent('3 calls');
  });


  it('renders chat projection messages with their route metadata', () => {
    render(
      <ArchitectRunProjection
        activeTab="chat"
        onTabChange={vi.fn()}
        run={makeRun({
          chat: {
            runId: 'flow-run-1',
            messages: [
              {
                id: 'message-1',
                eventId: 'event-1',
                speaker: 'router',
                content: 'Continue with evidence.',
                route: {
                  source: 'agent',
                  fromNodeId: 'implementer',
                  selectedNodeIds: ['goal-guard'],
                  nextNodeId: 'goal-guard',
                },
                createdAt: 1770000000000,
              },
            ],
          },
        })}
        schema={baseSchema}
      />,
    );

    expect(screen.getByTestId('architect-chat-message')).toHaveTextContent('router');
    expect(screen.getByTestId('architect-chat-message')).toHaveTextContent('Continue with evidence.');
    expect(screen.getByTestId('architect-chat-message')).toHaveTextContent('agent');
    expect(screen.getByTestId('architect-chat-message')).toHaveTextContent('implementer -> goal-guard');
  });

  it('keeps failed runs visible in the timeline instead of collapsing them into a loading state', () => {
    render(
      <ArchitectRunProjection
        activeTab="events"
        onTabChange={vi.fn()}
        run={makeRun({
        run: { status: 'failed' },
        events: [{
          id: 'event-1',
          runId: 'flow-run-1',
          sequence: 1,
          type: 'final_artifact',
          message: 'Goal Guard stopped on a failed validation.',
          createdAt: 1770000000000,
        }],
        })}
        schema={baseSchema}
      />,
    );

    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('Goal Guard stopped on a failed validation.')).toBeInTheDocument();
    expect(screen.getByText(/final_artifact/)).toBeInTheDocument();
  });
});

function makeWaitingRun(): ArchitectRunResult {
  return makeRun({
    run: { status: 'running' },
    agentFlowStatus: 'waiting_on_orchestrator',
    events: [],
  });
}

function makeRun(options: {
  run?: Partial<ArchitectRunResult['run']>;
  agentFlowRunId?: string;
  agentFlowStatus?: ArchitectRunResult['agentFlowStatus'];
  agentFlowSummary?: string;
  events?: ArchitectRunResult['events'];
  graph?: ArchitectRunResult['graph'];
  chat?: ArchitectRunResult['chat'];
} = {}): ArchitectRunResult {
  const {
    run: runOverrides = {},
    agentFlowRunId,
    agentFlowStatus,
    agentFlowSummary,
    events,
    graph,
    chat,
  } = options;

  const run = {
    id: 'flow-run-1',
    schemaId: 'goal_guard_delivery_loop',
    prompt: 'Build and verify the requested slice.',
    executionMode: 'subagent_execution',
    status: 'running',
    rootSessionId: 'root-session-1',
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    ...runOverrides,
  } as ArchitectRunResult['run'];

  return {
    run,
    agentFlowRunId,
    agentFlowStatus,
    agentFlowSummary,
    events: events ?? [
      {
        id: 'event-1',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Goal Guard selected the next step.',
        createdAt: 1770000000000,
      },
    ],
    graph: graph ?? {
      runId: run.id,
      nodes: [
        { id: 'implementer', label: 'Implementer', kind: 'role', status: 'completed', eventIds: ['event-1'] },
        { id: 'goal-guard', label: 'Goal Guard', kind: 'router', status: 'pending', eventIds: [] },
      ],
      edges: [
        { id: 'implementer-goal-guard', fromNodeId: 'implementer', toNodeId: 'goal-guard' },
      ],
      routeHops: [],
    },
    chat: chat ?? {
      runId: run.id,
      messages: [
        {
          id: 'message-1',
          eventId: 'event-1',
          speaker: 'router',
          content: 'Continue with evidence.',
          createdAt: 1770000000000,
        },
      ],
    },
  };
}

const baseSchema: ArchitectSchema = {
  id: 'goal_guard_delivery_loop',
  name: 'Goal Guard Delivery Loop',
  description: 'Two-agent implementer and Goal Guard delivery loop.',
  version: '1.0.0',
  roleSlots: [],
  nodes: [
    {
      id: 'implementer',
      label: 'Implementer',
      kind: 'role',
      x: 120,
      y: 120,
      slots: [],
      connections: [],
    },
    {
      id: 'goal-guard',
      label: 'Goal Guard',
      kind: 'router',
      behavior: { mode: 'rank_then_merge', fanOut: 'sequential' },
      x: 360,
      y: 180,
      slots: [],
      connections: [],
    },
  ],
  edges: [
    { id: 'implementer-goal-guard', fromNodeId: 'implementer', toNodeId: 'goal-guard' },
  ],
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
  outputArtifactSchema: 'Artifact',
};
