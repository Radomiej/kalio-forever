import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureChatRunSummary } from '@kalio/types';
import { ArchitectureRunTimeline } from './ArchitectureRunTimeline';

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
});
