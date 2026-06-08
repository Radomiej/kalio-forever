import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@kalio/types';
import { ExecutionGraphLiveSidebar } from './ExecutionGraphLiveSidebar';

describe('ExecutionGraphLiveSidebar', () => {
  it('can start collapsed when there is no live activity', () => {
    render(
      <ExecutionGraphLiveSidebar
        defaultCollapsed
        runningLoops={[]}
        runningToolActivities={[]}
        sessions={sessions}
        sessionTitleById={new Map(sessions.map((session) => [session.id, session.title]))}
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.getByTestId('execution-graph-live-sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('execution-graph-live-sidebar')).toHaveClass('self-start');
    expect(screen.getByTestId('execution-graph-live-sidebar-expand')).toHaveClass('h-11');
    expect(screen.getByTestId('execution-graph-live-sidebar-expand')).toHaveClass('w-11');
    expect(screen.queryByText('Recent sessions')).toBeNull();
  });

  it('collapses to a narrow restore rail and expands on demand', () => {
    render(
      <ExecutionGraphLiveSidebar
        runningLoops={[]}
        runningToolActivities={[]}
        sessions={sessions}
        sessionTitleById={new Map(sessions.map((session) => [session.id, session.title]))}
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Recent sessions/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('execution-graph-recent-sessions')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Recent sessions/ }));
    expect(screen.getByTestId('execution-graph-recent-sessions')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('execution-graph-live-sidebar-collapse'));

    expect(screen.getByTestId('execution-graph-live-sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('execution-graph-live-sidebar-expand')).toHaveClass('h-11');
    expect(screen.queryByTestId('execution-graph-recent-sessions')).toBeNull();

    fireEvent.click(screen.getByTestId('execution-graph-live-sidebar-expand'));

    expect(screen.getByRole('button', { name: /Recent sessions/ })).toBeInTheDocument();
  });

  it('opens recent sessions only when the user expands that section', () => {
    const onSelectSession = vi.fn();
    render(
      <ExecutionGraphLiveSidebar
        runningLoops={[]}
        runningToolActivities={[]}
        sessions={sessions}
        sessionTitleById={new Map(sessions.map((session) => [session.id, session.title]))}
        onSelectSession={onSelectSession}
      />,
    );

    expect(screen.queryByLabelText('Open recent session Main session')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Recent sessions/ }));
    fireEvent.click(screen.getByLabelText('Open recent session Main session'));

    expect(onSelectSession).toHaveBeenCalledWith('session-1');
  });

  it('keeps active activity discoverable in the collapsed rail', () => {
    render(
      <ExecutionGraphLiveSidebar
        defaultCollapsed
        runningLoops={[{
          sessionId: 'session-1',
          turnId: 'turn-1',
          agentRun: { label: 'UX review' },
        }]}
        runningToolActivities={[]}
        sessions={sessions}
        sessionTitleById={new Map(sessions.map((session) => [session.id, session.title]))}
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('1 active graph events')).toBeInTheDocument();
  });
});

const sessions: ChatSession[] = [
  {
    id: 'session-1',
    title: 'Main session',
    personaId: 'default',
    createdAt: 1,
    updatedAt: 2,
  },
];
