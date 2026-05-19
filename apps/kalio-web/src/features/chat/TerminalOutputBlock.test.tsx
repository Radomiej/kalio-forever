import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TerminalOutputBlock } from './TerminalOutputBlock';

describe('TerminalOutputBlock', () => {
  it('renders the Codex CLI label for codex runs (REGRESSION)', () => {
    const onToggle = vi.fn();

    render(
      <TerminalOutputBlock
        result={{ output: 'done', exitCode: 0, durationMs: 1200, agentId: 'codex' }}
        isExpanded={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText('Codex CLI')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle CLI agent output' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});