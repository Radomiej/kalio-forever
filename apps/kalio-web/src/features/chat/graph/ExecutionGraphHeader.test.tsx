import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ToolActivity } from '../../../store/agentStore';
import { ExecutionGraphHeader } from './ExecutionGraphHeader';

vi.mock('../../projects/ProjectPicker', () => ({
  ProjectPicker: ({ testId }: { testId: string }) => <button data-testid={testId} type="button">Project</button>,
}));

function makeToolActivity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    callId: 'call-1',
    toolName: 'run_subagent',
    args: {},
    status: 'running',
    startedAt: 1,
    ...overrides,
  };
}

describe('ExecutionGraphHeader', () => {
  it('uses session titles and fallback labels for live loops and caps visible tool chips at four', () => {
    const onCardDensityChange = vi.fn();
    const onFocusModeChange = vi.fn();
    const onDecreaseZoom = vi.fn();
    const onFitAll = vi.fn();
    const onIncreaseZoom = vi.fn();
    const onResetZoom = vi.fn();

    render(
      <ExecutionGraphHeader
        cardDensity="compact"
        collapseTools={false}
        focusMode="latest-architecture"
        hydrationStatus={{
          label: 'VFS 1 missing',
          tone: 'warning',
          detail: '1 branch read failed, 1 succeeded, 0 unknown',
          readFailures: 1,
          readSuccesses: 1,
          totalBranches: 2,
        }}
        onCardDensityChange={onCardDensityChange}
        onDecreaseZoom={onDecreaseZoom}
        onFitAll={onFitAll}
        onFocusModeChange={onFocusModeChange}
        onIncreaseZoom={onIncreaseZoom}
        onResetZoom={onResetZoom}
        runningLoops={[
          { sessionId: 'session-1', turnId: 'turn-1', agentRun: { label: 'Orchestrator' } },
          { sessionId: 'session-2', turnId: 'turn-2' },
          { sessionId: 'session-3', turnId: 'turn-3' },
        ]}
        runningToolActivities={[
          makeToolActivity({ callId: 'call-1', toolName: 'vfs_read' }),
          makeToolActivity({ callId: 'call-2', toolName: 'vfs_write' }),
          makeToolActivity({ callId: 'call-3', toolName: 'run_subagent' }),
          makeToolActivity({ callId: 'call-4', toolName: 'design_preview' }),
          makeToolActivity({ callId: 'call-5', toolName: 'spawn_cli_agent' }),
        ]}
        sessionTitleById={new Map([
          ['session-2', 'Branch read'],
        ])}
        showFocusToggle
        zoom={1.15}
      />,
    );

    expect(screen.getByText('Execution Graph')).toBeInTheDocument();
    expect(screen.getByTestId('talk-graph-switcher')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('talk-conversation-switcher')).toBeInTheDocument();
    expect(screen.queryByText('Prompts, turns, tools, subagents, artifacts and final responses.')).toBeNull();
    expect(screen.getByText('Orchestrator')).toBeInTheDocument();
    expect(screen.getByText('Branch read')).toBeInTheDocument();
    expect(screen.getByText('Agent run')).toBeInTheDocument();
    expect(screen.getByTestId('graph-zoom-out')).toHaveClass('min-h-11');
    expect(screen.getByTestId('graph-zoom-in')).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'More graph controls' })).toHaveClass('min-h-11');
    expect(screen.queryByRole('button', { name: 'Compact' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Detailed' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Latest run' })).toBeNull();
    expect(screen.queryByText('3 agents live')).toBeNull();
    expect(screen.queryByText('5 tools active')).toBeNull();
    expect(screen.getByText('vfs_read')).toBeInTheDocument();
    expect(screen.getByText('vfs_write')).toBeInTheDocument();
    expect(screen.getByText('run_subagent')).toBeInTheDocument();
    expect(screen.getByText('design_preview')).toBeInTheDocument();
    expect(screen.queryByText('spawn_cli_agent')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));
    expect(screen.getByText('Card density')).toBeInTheDocument();
    expect(screen.getByText('Run scope')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Input help/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('graph-gesture-hints')).toBeNull();
    expect(screen.getByText('3 agents / 5 tools')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Input help/ }));
    expect(screen.getByTestId('graph-gesture-hints')).toHaveTextContent('hold Space over nodes to pan');
    expect(screen.getByTestId('graph-gesture-hints')).toHaveTextContent('Drag node body to reposition it');
    expect(screen.getByText('tools expanded')).toBeInTheDocument();
    expect(screen.getByText('pan / wheel')).toBeInTheDocument();
    expect(screen.getByText('3 agents live')).toBeInTheDocument();
    expect(screen.getByText('5 tools active')).toBeInTheDocument();
    expect(screen.getByText('VFS 1 missing')).toHaveAttribute('title', '1 branch read failed, 1 succeeded, 0 unknown');
    expect(screen.getByTestId('graph-card-density-compact')).toHaveClass('min-h-6');
    expect(screen.getByTestId('graph-card-density-detailed')).toHaveClass('min-h-6');
    expect(screen.getByRole('button', { name: 'Compact' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detailed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Latest run' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('graph-card-density-detailed'));
    fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));
    fireEvent.click(screen.getByTestId('graph-zoom-out'));
    fireEvent.click(screen.getByTestId('graph-zoom-in'));
    fireEvent.click(screen.getByTestId('graph-zoom-reset'));
    fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));
    fireEvent.click(screen.getByTestId('graph-fit-all'));

    expect(onCardDensityChange).toHaveBeenCalledWith('detailed');
    expect(onFocusModeChange).toHaveBeenCalledWith('all');
    expect(onDecreaseZoom).toHaveBeenCalled();
    expect(onIncreaseZoom).toHaveBeenCalled();
    expect(onResetZoom).toHaveBeenCalled();
    expect(onFitAll).toHaveBeenCalled();
  });

  it('uses singular live counters when exactly one loop and one tool are active', () => {
    render(
      <ExecutionGraphHeader
        cardDensity="compact"
        collapseTools
        focusMode="latest-architecture"
        hydrationStatus={null}
        onCardDensityChange={vi.fn()}
        onDecreaseZoom={vi.fn()}
        onFitAll={vi.fn()}
        onFocusModeChange={vi.fn()}
        onIncreaseZoom={vi.fn()}
        onResetZoom={vi.fn()}
        runningLoops={[{ sessionId: 'session-1', turnId: 'turn-1' }]}
        runningToolActivities={[makeToolActivity({ callId: 'call-1', toolName: 'vfs_read' })]}
        sessionTitleById={new Map()}
        showFocusToggle={true}
        zoom={1}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));
    expect(screen.getByText('1 agent / 1 tool')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Input help/ }));
    expect(screen.getByText('1 agent live')).toBeInTheDocument();
    expect(screen.getByText('1 tool active')).toBeInTheDocument();
    expect(screen.getByText('tools grouped')).toBeInTheDocument();
  });

  it('offers the project picker in the active graph header', () => {
    render(
      <ExecutionGraphHeader
        cardDensity="compact"
        collapseTools
        focusMode="latest-architecture"
        hydrationStatus={null}
        onCardDensityChange={vi.fn()}
        onDecreaseZoom={vi.fn()}
        onFitAll={vi.fn()}
        onFocusModeChange={vi.fn()}
        onIncreaseZoom={vi.fn()}
        onResetZoom={vi.fn()}
        projectId="project-1"
        onProjectChange={vi.fn()}
        runningLoops={[]}
        runningToolActivities={[]}
        sessionTitleById={new Map()}
        showFocusToggle={false}
        zoom={1}
      />,
    );

    expect(screen.getByTestId('graph-header-project-picker')).toBeInTheDocument();
  });

  it('hides the focus toggle when disabled and applies success hydration styling', () => {
    render(
      <ExecutionGraphHeader
        cardDensity="detailed"
        collapseTools
        focusMode="all"
        hydrationStatus={{
          label: 'VFS 2/2 ok',
          tone: 'success',
          detail: 'All architecture branch reads succeeded',
          readFailures: 0,
          readSuccesses: 2,
          totalBranches: 2,
        }}
        onCardDensityChange={vi.fn()}
        onDecreaseZoom={vi.fn()}
        onFitAll={vi.fn()}
        onFocusModeChange={vi.fn()}
        onIncreaseZoom={vi.fn()}
        onResetZoom={vi.fn()}
        runningLoops={[]}
        runningToolActivities={[]}
        sessionTitleById={new Map()}
        showFocusToggle={false}
        zoom={0.95}
      />,
    );

    expect(screen.queryByTestId('graph-focus-latest-architecture')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));
    expect(screen.queryByTestId('graph-focus-latest-architecture')).toBeNull();
    expect(screen.getByText('0 agents / 0 tools')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Input help/ }));
    expect(screen.getByText('tools grouped')).toBeInTheDocument();
    expect(screen.getByText('VFS 2/2 ok')).toHaveClass('border-emerald-500/25');
  });
});
