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
});
