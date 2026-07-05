import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureChatRunSummary, ArchitectureGraphProjection, ChatSession } from '@kalio/types';
import { ArchitectureRunTimeline } from './ArchitectureRunTimeline';
import { statusForStep } from './ArchitectureRunTimeline.stages';

type ArchitectureRunWithGraph = ArchitectureChatRunSummary & {
  graphNodes?: ArchitectureGraphProjection['nodes'];
  graphEdges?: ArchitectureGraphProjection['edges'];
};

describe('ArchitectureRunTimeline', () => {
  it('does not derive running status from planned graph status alone', () => {
    expect(statusForStep({
      speaker: 'finalizer',
      content: '',
      nodeId: 'final-artifact',
      plannedLabel: 'Finalizer',
      plannedStatus: 'running',
    })).toBe(null);
  });

  it('renders a partial trace step without throwing when typed projection fields are missing', () => {
    const partialStep = {
      content: 'Partial runtime event during reconnect.',
      eventId: 'run-partial:event:1',
    } as unknown as ArchitectureChatRunSummary['trace'][number];
    const run: ArchitectureChatRunSummary = {
      runId: 'run-partial',
      schemaId: 'five-minds-council',
      status: 'running',
      routeHops: [],
      trace: [partialStep],
    };

    expect(() => render(
      <ArchitectureRunTimeline
        run={run}
        onOpenCanvas={vi.fn()}
        onOpenBranch={vi.fn()}
      />,
    )).not.toThrow();
    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Unknown');
  });

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

  it('renders terminal graph node statuses from typed projection without falling back to pending text', () => {
    const run: ArchitectureRunWithGraph = {
      runId: 'run-terminal-status',
      schemaId: 'strategic-decision-council',
      status: 'failed',
      routeHops: [],
      graphNodes: [
        {
          id: 'router',
          label: 'Router',
          kind: 'router',
          status: 'failed',
          eventIds: ['run-terminal-status:event:1'],
        },
        {
          id: 'final-artifact',
          label: 'Finalizer',
          kind: 'artifact',
          status: 'cancelled',
          eventIds: [],
        },
      ],
      graphEdges: [
        { id: 'edge-final', fromNodeId: 'router', toNodeId: 'final-artifact' },
      ],
      trace: [],
    };

    render(
      <ArchitectureRunTimeline
        run={run}
        onOpenCanvas={vi.fn()}
        onOpenBranch={vi.fn()}
      />,
    );

    expect(screen.getByTestId('architecture-route-router')).toHaveAttribute('data-status', 'failed');
    expect(screen.getByTestId('architecture-route-router')).toHaveTextContent('failed');
    expect(screen.getByTestId('architecture-route-finalizer')).toHaveAttribute('data-status', 'cancelled');
    expect(screen.getByTestId('architecture-route-finalizer')).toHaveTextContent('cancelled');
    expect(screen.getByTestId('architecture-route-finalizer')).not.toHaveTextContent('pending');
  });

  it('renders the orchestrator actor label while keeping router semantics in secondary metadata', () => {
    const run: ArchitectureRunWithGraph = {
      runId: 'run-orchestrator',
      schemaId: 'Architecture Debate',
      status: 'running',
      routeHops: [],
      graphNodes: [
        {
          id: 'orchestrator',
          sessionId: 'arch-run-orchestrator-orchestrator',
          label: 'Orchestrator',
          kind: 'router',
          status: 'running',
          eventIds: ['run-orchestrator:event:1'],
        },
      ],
      graphEdges: [
        { id: 'e1', fromNodeId: 'orchestrator', toNodeId: 'final-artifact' },
      ],
      trace: [
        {
          speaker: 'router',
          sessionId: 'arch-run-orchestrator-orchestrator',
          content: 'Route to final artifact.',
          eventId: 'run-orchestrator:event:1',
          nodeId: 'orchestrator',
          nextNodeId: 'final-artifact',
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

    const card = screen.getByTestId('architecture-route-router');
    expect(card).toHaveTextContent('Orchestrator');
    expect(card).toHaveTextContent('router');
    expect(card).toHaveTextContent('to final-artifact');
  });

  it('does not infer router labels from degraded router content when typed metadata is missing', () => {
    const run: ArchitectureChatRunSummary = {
      runId: 'run-router-fallback',
      schemaId: 'Architecture Debate',
      status: 'running',
      routeHops: [],
      trace: [
        {
          speaker: 'router',
          content: '### Router\n\nRoute: runtime_fallback -> researcher\n\nOrchestrator hit a recoverable branch error: Sub-agent timed out after 300000ms.',
          eventId: 'run-router-fallback:event:1',
          nodeId: 'router',
          nextNodeId: 'researcher',
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
    expect(screen.getByTestId('architecture-route-shell')).not.toHaveTextContent('Orchestrator');
    expect(screen.getByTestId('architecture-route-router')).toHaveTextContent('Router');
    expect(screen.getByTestId('architecture-route-router')).not.toHaveTextContent('Orchestrator');
    expect(screen.getByTestId('architecture-route-router')).toHaveTextContent('router');
  });

  it('uses router branch session labels for degraded merge steps when the run sessions carry them', () => {
    const run: ArchitectureChatRunSummary = {
      runId: 'run-router-session-labels',
      schemaId: 'Architecture Debate',
      status: 'completed',
      routeHops: [],
      trace: [
        {
          speaker: 'router',
          content: '### Router\n\nRoute: runtime_fallback -> researcher\n\nOrchestrator hit a recoverable branch error: Sub-agent timed out after 300000ms.',
          eventId: 'run-router-session-labels:event:1',
          nodeId: 'router',
          nextNodeId: 'researcher',
        },
        {
          speaker: 'participant',
          content: 'Researcher completed the evidence pass.',
          eventId: 'run-router-session-labels:event:2',
          nodeId: 'researcher',
          nextNodeId: 'router',
        },
        {
          speaker: 'router',
          content: '### Router\n\nRoute: agent -> final-artifact\n\nMerged the selected branch output.',
          eventId: 'run-router-session-labels:event:3',
          nodeId: 'router',
          nextNodeId: 'final-artifact',
        },
      ],
    };
    const runSessions: ChatSession[] = [
      {
        id: 'arch-run-router-session-labels-orchestrator',
        personaId: 'orchestrator',
        title: 'Architecture Debate: Orchestrator',
        kind: 'subagent',
        parentSessionId: 'arch-run-router-session-labels-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'orchestrator',
          architectureContext: {
            architectureRunId: 'run-router-session-labels',
            schemaId: 'architecture_debate',
            schemaName: 'Architecture Debate',
            roleSlotId: 'orchestrator',
            roleSlotType: 'router',
            roleLabel: 'Orchestrator',
            displayLabel: 'Orchestrator',
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'arch-run-router-session-labels-synthesizer',
        personaId: 'synthesizer',
        title: 'Architecture Debate: Synthesizer',
        kind: 'subagent',
        parentSessionId: 'arch-run-router-session-labels-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'synthesizer',
          architectureContext: {
            architectureRunId: 'run-router-session-labels',
            schemaId: 'architecture_debate',
            schemaName: 'Architecture Debate',
            roleSlotId: 'synthesizer',
            roleSlotType: 'router',
            roleLabel: 'Synthesizer',
            displayLabel: 'Synthesizer',
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    render(
      <ArchitectureRunTimeline
        run={run}
        runSessions={runSessions}
        onOpenCanvas={vi.fn()}
        onOpenBranch={vi.fn()}
      />,
    );

    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Orchestrator');
    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Synthesizer');
    expect(screen.getAllByTestId('architecture-route-router')[1]).toHaveTextContent('Synthesizer');
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

  it('does not render unevidenced pending finalizer while earlier nodes are still running', () => {
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

    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Orchestrator');
    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Sub-agents 5');
    expect(screen.getByTestId('architecture-route-shell')).not.toHaveTextContent('Finalizer');
    expect(screen.getByTestId('architecture-route-parallel-agents')).toHaveTextContent('Parallel sub-agents');
    expect(screen.getByTestId('architecture-route-parallel-agents')).toHaveTextContent('5');
    expect(screen.getByTestId('architecture-route-parallel-agents')).toHaveTextContent('pending');
    expect(screen.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'running');
    expect(screen.getAllByTestId('architecture-route-router')).toHaveLength(2);
    expect(screen.queryByTestId('architecture-route-finalizer')).toBeNull();
  });

  it('does not treat preallocated finalizer session id as runtime evidence', () => {
    const run: ArchitectureRunWithGraph = {
      runId: 'run-preallocated-finalizer',
      schemaId: 'Lab Bug Hunter',
      status: 'running',
      routeHops: [],
      graphNodes: [
        {
          id: 'orchestrator',
          label: 'Orchestrator',
          kind: 'router',
          status: 'running',
          hasRuntimeEvidence: true,
          eventIds: ['run-preallocated-finalizer:event:1'],
        },
        {
          id: 'final-artifact',
          label: 'Finalizer',
          kind: 'artifact',
          status: 'running',
          sessionId: 'arch-run-preallocated-finalizer-final-artifact',
          hasRuntimeEvidence: false,
          eventIds: [],
        },
      ],
      graphEdges: [
        { id: 'e1', fromNodeId: 'orchestrator', toNodeId: 'final-artifact' },
      ],
      trace: [
        {
          speaker: 'router',
          content: 'Orchestrator is still routing.',
          eventId: 'run-preallocated-finalizer:event:1',
          nodeId: 'orchestrator',
          nextNodeId: 'final-artifact',
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

    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Orchestrator');
    expect(screen.queryByTestId('architecture-route-finalizer')).toBeNull();
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
    expect(screen.getAllByText('pending').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByTestId('architecture-route-finalizer')).toBeNull();
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

  it('renders trace steps without prose content instead of crashing on string cleanup', () => {
    const run: ArchitectureChatRunSummary = {
      runId: 'run-missing-content',
      schemaId: 'strategic-decision-council',
      status: 'running',
      routeHops: [],
      trace: [
        {
          speaker: 'finalizer',
          content: undefined as unknown as string,
          eventId: 'run-missing-content:event:9',
          nodeId: 'final-artifact',
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

    expect(screen.getByTestId('architecture-route-finalizer')).toHaveTextContent(
      'Final answer produced from the routed graph outputs.',
    );
  });
});
