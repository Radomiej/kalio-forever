import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TerminalOutputBlock } from './TerminalOutputBlock';

describe('TerminalOutputBlock', () => {
  it('renders the Codex CLI label, duration, and output body when expanded', () => {
    const onToggle = vi.fn();

    render(
      <TerminalOutputBlock
        result={{ output: 'done', exitCode: 0, durationMs: 1200, agentId: 'codex' }}
        isExpanded={true}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('1.2s')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(screen.queryByText(/exit=/i)).not.toBeInTheDocument();
  });

  it('shows failure metadata and the empty-output placeholder when nothing was printed', () => {
    const onToggle = vi.fn();

    render(
      <TerminalOutputBlock
        result={{ output: '', exitCode: 2, durationMs: 61_000, agentId: 'unknown-cli' }}
        isExpanded={true}
        onToggle={onToggle}
        agentId="unknown-cli"
      />,
    );

    expect(screen.getByText('unknown-cli')).toBeInTheDocument();
    expect(screen.getByText('exit=2')).toBeInTheDocument();
    expect(screen.getByText('1m 1s')).toBeInTheDocument();
    expect(screen.getByText('(no output)')).toBeInTheDocument();
  });
});
