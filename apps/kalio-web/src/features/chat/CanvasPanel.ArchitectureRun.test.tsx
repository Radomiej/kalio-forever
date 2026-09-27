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

  it('shows the Auto-routing selection in Canvas without linking to a router session', () => {
    const run: ArchitectureChatRunSummary = {
      runId: 'run-auto-canvas',
      schemaId: 'auto-routing-flow',
      status: 'completed',
      routeHops: [],
      trace: [{
        speaker: 'auto_router',
        content: '',
        eventId: 'run-auto-canvas:event:1',
        nodeId: 'auto-route',
        nextNodeId: 'agent',
        selectedEdgeId: 'choice-agent',
        confidence: 0.9,
        decisionReason: 'confidence_met',
      }],
    };
    const routerSession = {
      id: 'router-session',
      personaId: 'default',
      title: 'Legacy Router session',
      createdAt: 1,
      updatedAt: 1,
      runtimeContext: { runtimeKind: 'agent-flow-branch', architectureSlotId: 'orchestrator', roleSlotType: 'router' },
    } as import('@kalio/types').ChatSession;

    render(
      <ArchitectureRunCanvasSection
        run={run}
        sessions={[routerSession]}
        onOpenSession={vi.fn()}
        getBranchMessages={() => []}
        knownBranchSessionIds={new Set(['router-session'])}
      />,
    );

    const card = screen.getByTestId('architecture-run-step-run-auto-canvas:event:1');
    expect(card).toHaveTextContent('Auto-routing');
    expect(card).toHaveTextContent('edge choice-agent');
    expect(card).toHaveTextContent('90%');
    expect(card).toHaveTextContent('confidence_met');
    expect(screen.queryByTestId('architecture-open-branch-router-session')).toBeNull();
  });
});
