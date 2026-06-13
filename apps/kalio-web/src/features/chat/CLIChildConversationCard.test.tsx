import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CLIChildConversationCard } from './CLIChildConversationCard';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { eventBus } from '../../services/eventBus';

vi.mock('../../services/eventBus', () => ({
  eventBus: {
    stopTurn: vi.fn(() => true),
  },
}));

describe('CLIChildConversationCard', () => {
  beforeEach(() => {
    useAgentStore.setState({
      cliChildProjections: {
        'cli-child-1': {
          childSessionId: 'cli-child-1',
          parentSessionId: 'parent-1',
          parentCallId: 'call-1',
          agentId: 'codex',
          status: 'running',
          lastOutput: 'building...',
          toolName: 'spawn_cli_agent',
          childTitle: 'codex CLI',
        },
      },
      cliAgentOutput: { 'call-1': 'building...' },
    });
    useSessionStore.setState({
      sessions: [{
        id: 'cli-child-1',
        personaId: 'default',
        title: 'codex CLI',
        kind: 'cli-agent',
        parentSessionId: 'parent-1',
        parentToolCallId: 'call-1',
        createdAt: 1,
        updatedAt: 1,
      }],
      activeSessionId: 'parent-1',
      setActiveSession: vi.fn(),
      setPendingMessage: vi.fn(),
    });
  });

  it('renders CLI child card with status and output tail', () => {
    render(
      <CLIChildConversationCard
        toolName="spawn_cli_agent"
        parentSessionId="parent-1"
        parentCallId="call-1"
        childSessionId="cli-child-1"
      />,
    );
    expect(screen.getByTestId('cli-child-card-cli-child-1')).toBeInTheDocument();
    expect(screen.getByTestId('cli-child-status-cli-child-1')).toHaveTextContent('running');
    expect(screen.getByTestId('cli-child-output-cli-child-1')).toHaveTextContent('building...');
  });

  it('exposes open, stop, follow-up, and inspect actions', () => {
    const setActiveSession = vi.fn();
    const setPendingMessage = vi.fn();
    useSessionStore.setState({ setActiveSession, setPendingMessage });

    render(
      <CLIChildConversationCard
        toolName="spawn_cli_agent"
        parentSessionId="parent-1"
        parentCallId="call-1"
        childSessionId="cli-child-1"
      />,
    );

    fireEvent.click(screen.getByTestId('cli-child-open-cli-child-1'));
    expect(setActiveSession).toHaveBeenCalledWith('cli-child-1');

    fireEvent.click(screen.getByTestId('cli-child-followup-cli-child-1'));
    expect(setPendingMessage).toHaveBeenCalled();
    expect(setActiveSession).toHaveBeenCalledWith('cli-child-1');

    fireEvent.click(screen.getByTestId('cli-child-stop-cli-child-1'));
    expect(eventBus.stopTurn).toHaveBeenCalledWith('cli-child-1');
  });

  it('hides navigation actions when the child session does not exist yet', () => {
    useSessionStore.setState({
      sessions: [],
      activeSessionId: 'parent-1',
      setActiveSession: vi.fn(),
      setPendingMessage: vi.fn(),
    });

    render(
      <CLIChildConversationCard
        toolName="spawn_cli_agent"
        parentSessionId="parent-1"
        parentCallId="call-1"
        childSessionId="cli-child-1"
      />,
    );

    expect(screen.queryByTestId('cli-child-open-cli-child-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cli-child-followup-cli-child-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('cli-child-stop-cli-child-1')).toBeInTheDocument();
  });
});
