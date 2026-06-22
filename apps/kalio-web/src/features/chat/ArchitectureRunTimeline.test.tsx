import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureChatRunSummary, ArchitectureGraphProjection } from '@kalio/types';
import { ArchitectureRunTimeline } from './ArchitectureRunTimeline';

type ArchitectureRunWithGraph = ArchitectureChatRunSummary & {
  graphNodes?: ArchitectureGraphProjection['nodes'];
  graphEdges?: ArchitectureGraphProjection['edges'];
};

describe('ArchitectureRunTimeline', () => {
  it('surfaces router contract confidence, next action, and fallback status', () => {
    const run: ArchitectureChatRunSummary = {
      runId: 'run-1',
      schemaId: 'five-minds-council',
      status: 'completed',
      routeHops: [],
      trace: [
        {
          speaker: 'router',
          content: 'Merged toward final artifact.',
          eventId: 'run-1:event:10',
          nodeId: 'synthesizer',
          nextNodeId: 'final-artifact',
          routerOutput: {
            selectedStrategy: 'final-artifact',
            mergedDecision: 'Use the small renderer-core slice.',
            acceptedInputs: [
              {
                fromSlot: 'pragmatist',
                insight: 'Input from Pragmatist',
                whyAccepted: 'Runtime fallback accepted this input.',
              },
            ],
            rejectedInputs: [],
            unresolvedConflicts: [],
            risks: [],
            confidence: 0.55,
            nextAction: 'finalize',
          },
        },
      ],
    };

    render(
      <ArchitectureRunTimeline
        run={run}
        onOpenCanvas={vi.fn()}
        onOpenBranch={vi.fn()}
      />,
    );

    expect(screen.getByTestId('architecture-router-contract')).toHaveTextContent('confidence 55%');
    expect(screen.getByTestId('architecture-router-contract')).toHaveTextContent('finalize');
    expect(screen.getByTestId('architecture-router-contract')).toHaveTextContent('fallback contract');
    expect(screen.getByTestId('architecture-router-contract')).toHaveTextContent('Use the small renderer-core slice.');
  });

  it('keeps branch cards to short readable summaries while preserving full text in details metadata', () => {
    const run: ArchitectureChatRunSummary = {
      runId: 'run-2',
      schemaId: 'strategic-decision-council',
      status: 'completed',
      routeHops: [],
      trace: [
        {
          speaker: 'participant',
          content: '## Pragmatist Contribution\n\n**Recommendation:** Use Next.js with a lightweight RSS aggregation worker, then add search after ingestion proves stable.\n\n| Layer | Choice |\n| --- | --- |\n| Frontend | Next.js |',
          eventId: 'run-2:event:1',
          nodeId: 'pragmatist',
          nextNodeId: 'router',
          stream: {
            streamGroupId: 'run-2',
            branchSessionId: 'branch-pragmatist',
            status: 'completed',
            chunkCount: 12,
            text: 'full branch text',
          },
        },
      ],
    };

    render(
      <ArchitectureRunTimeline
        run={run}
        onOpenCanvas={vi.fn()}
        onOpenBranch={vi.fn()}
      />,
    );

    const agentCard = screen.getByTestId('architecture-route-agent');
    expect(agentCard).toHaveTextContent('Pragmatist');
    expect(agentCard).toHaveTextContent('Recommendation: Use Next.js');
    expect(agentCard).not.toHaveTextContent('## Pragmatist Contribution');
    expect(agentCard).not.toHaveTextContent('| Layer | Choice |');
    expect(agentCard.querySelector('p')).toHaveAttribute('title', expect.stringContaining('| Layer | Choice |'));
  });

  it('opens focused run details when a router step is clicked', () => {
    const onOpenStep = vi.fn();
    const run: ArchitectureChatRunSummary = {
      runId: 'run-3',
      schemaId: 'strategic-decision-council',
      status: 'running',
      routeHops: [],
      trace: [
        {
          speaker: 'router',
          content: 'Dispatch council branches.',
          eventId: 'run-3:event:1',
          nodeId: 'router',
          nextNodeId: 'pragmatist',
        },
      ],
    };

    render(
      <ArchitectureRunTimeline
        run={run}
        onOpenCanvas={vi.fn()}
        onOpenBranch={vi.fn()}
        onOpenStep={onOpenStep}
      />,
    );

    screen.getByTestId('architecture-route-router').click();

    expect(onOpenStep).toHaveBeenCalledWith({ eventId: 'run-3:event:1', nodeId: 'router' });
  });

  it('opens the router sub-conversation when the step exposes a known session id', () => {
    const onOpenBranch = vi.fn();
    const onOpenStep = vi.fn();
    const run: ArchitectureRunWithGraph = {
      runId: 'run-router-session',
      schemaId: 'strategic-decision-council',
      status: 'running',
      routeHops: [],
      graphNodes: [
        {
          id: 'router',
          sessionId: 'arch-run-router-session-router',
          label: 'Router',
          kind: 'router',
          status: 'running',
          eventIds: ['run-router-session:event:1'],
        },
      ],
      graphEdges: [],
      trace: [
        {
          speaker: 'router',
          sessionId: 'arch-run-router-session-router',
          content: 'Dispatch council branches.',
          eventId: 'run-router-session:event:1',
          nodeId: 'router',
          nextNodeId: 'pragmatist',
        },
      ],
    };

    render(
      <ArchitectureRunTimeline
        run={run}
        onOpenCanvas={vi.fn()}
        onOpenBranch={onOpenBranch}
        onOpenStep={onOpenStep}
        knownBranchSessionIds={new Set(['arch-run-router-session-router'])}
      />,
    );

    const routerCard = screen.getByTestId('architecture-route-router');
    expect(routerCard).toHaveAttribute('data-session-id', 'arch-run-router-session-router');
    expect(routerCard).toHaveAttribute('data-status', 'running');

    fireEvent.click(routerCard);

    expect(onOpenBranch).toHaveBeenCalledWith('arch-run-router-session-router');
    expect(onOpenStep).not.toHaveBeenCalled();
  });

  it('keeps graph node session ids when matching trace steps do not carry them', () => {
    const onOpenBranch = vi.fn();
    const onOpenStep = vi.fn();
    const run: ArchitectureRunWithGraph = {
      runId: 'run-router-graph-session',
      schemaId: 'strategic-decision-council',
      status: 'completed',
      routeHops: [],
      graphNodes: [
        {
          id: 'router',
          sessionId: 'arch-run-router-graph-session-router',
          label: 'Router',
          kind: 'router',
          status: 'completed',
          eventIds: ['run-router-graph-session:event:1'],
        },
      ],
      graphEdges: [],
      trace: [
        {
          speaker: 'router',
          content: 'Route to final artifact.',
          eventId: 'run-router-graph-session:event:1',
          nodeId: 'router',
          nextNodeId: 'final-artifact',
        },
      ],
    };

    render(
      <ArchitectureRunTimeline
        run={run}
        onOpenCanvas={vi.fn()}
        onOpenBranch={onOpenBranch}
        onOpenStep={onOpenStep}
        knownBranchSessionIds={new Set(['arch-run-router-graph-session-router'])}
      />,
    );

    const routerCard = screen.getByTestId('architecture-route-router');
    expect(routerCard).toHaveAttribute('data-session-id', 'arch-run-router-graph-session-router');
    expect(routerCard).toHaveAttribute('data-status', 'completed');

    fireEvent.click(routerCard);

    expect(onOpenBranch).toHaveBeenCalledWith('arch-run-router-graph-session-router');
    expect(onOpenStep).not.toHaveBeenCalled();
  });

  it('renders planned pending stages from graph nodes before the trace completes', () => {
    const run: ArchitectureRunWithGraph = {
      runId: 'run-live',
      schemaId: 'Strategic Decision Council',
      status: 'running',
      routeHops: [],
      graphNodes: [
        { id: 'orchestrator', label: 'Orchestrator', kind: 'router', status: 'running', eventIds: ['run-live:event:1'] },
        { id: 'pragmatist', label: 'Pragmatist', kind: 'role', status: 'completed', eventIds: ['run-live:event:2'] },
        { id: 'innovator', label: 'Innovator', kind: 'role', status: 'running', eventIds: ['run-live:event:3'] },
        { id: 'analyst', label: 'Analyst', kind: 'role', status: 'pending', eventIds: [] },
        { id: 'user-advocate', label: 'User Advocate', kind: 'role', status: 'pending', eventIds: [] },
        { id: 'shadow', label: 'Shadow', kind: 'role', status: 'pending', eventIds: [] },
        { id: 'synthesizer', label: 'Router merge', kind: 'router', status: 'pending', eventIds: [] },
        { id: 'final-artifact', label: 'Finalizer', kind: 'artifact', status: 'pending', eventIds: [] },
      ],
      graphEdges: [
        { id: 'e1', fromNodeId: 'orchestrator', toNodeId: 'pragmatist' },
        { id: 'e2', fromNodeId: 'orchestrator', toNodeId: 'innovator' },
        { id: 'e3', fromNodeId: 'orchestrator', toNodeId: 'analyst' },
        { id: 'e4', fromNodeId: 'orchestrator', toNodeId: 'user-advocate' },
        { id: 'e5', fromNodeId: 'orchestrator', toNodeId: 'shadow' },
        { id: 'e6', fromNodeId: 'pragmatist', toNodeId: 'synthesizer' },
        { id: 'e7', fromNodeId: 'innovator', toNodeId: 'synthesizer' },
        { id: 'e8', fromNodeId: 'analyst', toNodeId: 'synthesizer' },
        { id: 'e9', fromNodeId: 'user-advocate', toNodeId: 'synthesizer' },
        { id: 'e10', fromNodeId: 'shadow', toNodeId: 'synthesizer' },
        { id: 'e11', fromNodeId: 'synthesizer', toNodeId: 'final-artifact' },
      ],
      trace: [
        {
          speaker: 'router',
          content: 'Orchestrator is dispatching the council.',
          eventId: 'run-live:event:1',
          nodeId: 'orchestrator',
          nextNodeId: 'pragmatist',
        },
        {
          speaker: 'participant',
          content: 'Pragmatist answer.',
          eventId: 'run-live:event:2',
          nodeId: 'pragmatist',
          nextNodeId: 'synthesizer',
          stream: {
            streamGroupId: 'architecture:run-live:pragmatist',
            branchSessionId: 'arch-run-live-pragmatist',
            status: 'completed',
            chunkCount: 4,
            text: 'Pragmatist answer.',
          },
        },
      ],
    };

    render(
      <ArchitectureRunTimeline
        run={run}
        onOpenCanvas={vi.fn()}
        onOpenBranch={vi.fn()}
      />,
    );

    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Router');
    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Sub-agents 5');
    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Finalizer');
    expect(screen.getByTestId('architecture-route-parallel-agents')).toHaveTextContent('Parallel sub-agents');
    expect(screen.getByTestId('architecture-route-parallel-agents')).toHaveTextContent('5');
    expect(screen.getByTestId('architecture-route-parallel-agents')).toHaveTextContent('pending');
    expect(screen.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'running');
    expect(screen.getAllByTestId('architecture-route-router')).toHaveLength(2);
    expect(screen.getByTestId('architecture-route-finalizer')).toHaveTextContent('pending');
    expect(screen.getByTestId('architecture-route-finalizer')).toHaveAttribute('data-status', 'pending');
  });

  it('renders graph-only pending stages before any trace messages exist', () => {
    const run: ArchitectureRunWithGraph = {
      runId: 'run-empty-trace',
      schemaId: 'Strategic Decision Council',
      status: 'running',
      routeHops: [],
      trace: [],
      graphNodes: [
        { id: 'parallel-deliberation', label: 'Parallel Deliberation', kind: 'parallel', status: 'running', eventIds: [] },
        { id: 'pragmatist', label: 'Pragmatist', kind: 'role', status: 'pending', eventIds: [] },
        { id: 'innovator', label: 'Innovator', kind: 'role', status: 'pending', eventIds: [] },
        { id: 'analyst', label: 'Analyst', kind: 'role', status: 'pending', eventIds: [] },
        { id: 'user-advocate', label: 'User Advocate', kind: 'role', status: 'pending', eventIds: [] },
        { id: 'shadow', label: 'Shadow', kind: 'role', status: 'pending', eventIds: [] },
        { id: 'router', label: 'Router', kind: 'router', status: 'pending', eventIds: [] },
        { id: 'final-artifact', label: 'Final Artifact', kind: 'artifact', status: 'pending', eventIds: [] },
      ],
      graphEdges: [
        { id: 'e1', fromNodeId: 'parallel-deliberation', toNodeId: 'pragmatist' },
        { id: 'e2', fromNodeId: 'parallel-deliberation', toNodeId: 'innovator' },
        { id: 'e3', fromNodeId: 'parallel-deliberation', toNodeId: 'analyst' },
        { id: 'e4', fromNodeId: 'parallel-deliberation', toNodeId: 'user-advocate' },
        { id: 'e5', fromNodeId: 'parallel-deliberation', toNodeId: 'shadow' },
        { id: 'e6', fromNodeId: 'pragmatist', toNodeId: 'router' },
        { id: 'e7', fromNodeId: 'innovator', toNodeId: 'router' },
        { id: 'e8', fromNodeId: 'analyst', toNodeId: 'router' },
        { id: 'e9', fromNodeId: 'user-advocate', toNodeId: 'router' },
        { id: 'e10', fromNodeId: 'shadow', toNodeId: 'router' },
        { id: 'e11', fromNodeId: 'router', toNodeId: 'final-artifact' },
      ],
    };

    render(
      <ArchitectureRunTimeline
        run={run}
        onOpenCanvas={vi.fn()}
        onOpenBranch={vi.fn()}
      />,
    );

    expect(screen.getByText('running / 8 graph steps')).toBeTruthy();
    expect(screen.getByTestId('architecture-route-parallel-agents')).toHaveTextContent('5');
    expect(screen.getAllByText('pending').length).toBeGreaterThanOrEqual(6);
    expect(screen.getByTestId('architecture-route-finalizer')).toHaveTextContent('pending');
  });

  it('treats precreated placeholder branch ids as non-openable when they are not in the known branch set', () => {
    const onOpenBranch = vi.fn();
    const onOpenStep = vi.fn();
    const run: ArchitectureRunWithGraph = {
      runId: 'run-placeholder',
      schemaId: 'Strategic Decision Council',
      status: 'running',
      routeHops: [],
      trace: [],
      graphNodes: [
        { id: 'analyst', label: 'Analyst', kind: 'role', status: 'pending', eventIds: [] },
      ],
      graphEdges: [],
    };

    render(
      <ArchitectureRunTimeline
        run={run}
        onOpenCanvas={vi.fn()}
        onOpenBranch={onOpenBranch}
        onOpenStep={onOpenStep}
        knownBranchSessionIds={new Set()}
      />,
    );

    fireEvent.click(screen.getByTestId('architecture-route-agent'));

    expect(onOpenBranch).not.toHaveBeenCalled();
    expect(onOpenStep).toHaveBeenCalledWith({ eventId: undefined, nodeId: 'analyst' });
  });
});
