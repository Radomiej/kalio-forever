import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureChatRunSummary } from '@kalio/types';
import { ArchitectureRunCanvasSection } from './CanvasPanel.ArchitectureRun';

describe('ArchitectureRunCanvasSection', () => {
  it('highlights the focused architecture trace step in the right canvas', () => {
    const run: ArchitectureChatRunSummary = {
      runId: 'run-1',
      schemaId: 'strategic-decision-council',
      status: 'completed',
      routeHops: [],
      trace: [
        {
          speaker: 'router',
          content: 'Dispatch council branches.',
          eventId: 'run-1:event:1',
          nodeId: 'router',
          nextNodeId: 'pragmatist',
        },
        {
          speaker: 'participant',
          content: 'Pragmatist branch result.',
          eventId: 'run-1:event:2',
          nodeId: 'pragmatist',
          nextNodeId: 'router',
        },
      ],
    };

    render(
      <ArchitectureRunCanvasSection
        run={run}
        sessions={[]}
        onOpenSession={vi.fn()}
        getBranchMessages={() => []}
        focused
        focusedStep={{ eventId: 'run-1:event:2', nodeId: 'pragmatist' }}
      />,
    );

    expect(screen.getByTestId('architecture-run-step-run-1:event:1')).toHaveAttribute('data-focused-step', 'false');
    expect(screen.getByTestId('architecture-run-step-run-1:event:2')).toHaveAttribute('data-focused-step', 'true');
  });
});
