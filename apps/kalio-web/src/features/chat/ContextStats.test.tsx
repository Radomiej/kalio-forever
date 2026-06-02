import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextStats } from './ContextStats';
import type { TokenCount } from '../../services/tokenCounter';

const makeTokenCount = (overrides: Partial<TokenCount> = {}): TokenCount => ({
  total: 1000,
  breakdown: { tools: 100, systemPrompt: 200, skills: 50, history: 500, images: 150 },
  cacheable: 350,
  contextLimit: 32000,
  usagePercent: 3,
  ...overrides,
});

describe('ContextStats', () => {
  it('renders context stats panel with data-testid', () => {
    render(<ContextStats tokenCount={makeTokenCount()} onClose={vi.fn()} />);
    expect(screen.getByTestId('context-stats-panel')).toBeInTheDocument();
  });

  it('shows system prompt section when systemPrompt prop provided', () => {
    render(
      <ContextStats
        tokenCount={makeTokenCount()}
        onClose={vi.fn()}
        systemPrompt="You are helpful."
      />,
    );
    expect(screen.getByTestId('context-stats-system-prompt')).toBeInTheDocument();
    expect(screen.getByText(/System Prompt/)).toBeInTheDocument();
  });

  it('does not show system prompt section when systemPrompt is null', () => {
    render(<ContextStats tokenCount={makeTokenCount()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('context-stats-system-prompt')).not.toBeInTheDocument();
  });

  it('shows tools section when activeToolNames provided', () => {
    render(
      <ContextStats
        tokenCount={makeTokenCount()}
        onClose={vi.fn()}
        activeToolNames={['vfs_read', 'vfs_write']}
      />,
    );
    expect(screen.getByTestId('context-stats-tools')).toBeInTheDocument();
    // Click to expand tools list
    fireEvent.click(screen.getByText(/Tools \(/));
    expect(screen.getByText('vfs_read')).toBeInTheDocument();
    expect(screen.getByText('vfs_write')).toBeInTheDocument();
  });

  it('does not show tools section when activeToolNames empty', () => {
    render(
      <ContextStats tokenCount={makeTokenCount()} onClose={vi.fn()} activeToolNames={[]} />,
    );
    expect(screen.queryByTestId('context-stats-tools')).not.toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<ContextStats tokenCount={makeTokenCount()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('context-stats-close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows compact button when onCompactNow provided', () => {
    render(<ContextStats tokenCount={makeTokenCount()} onClose={vi.fn()} onCompactNow={vi.fn()} />);
    expect(screen.getByTestId('compact-now-btn')).toBeInTheDocument();
  });

  it('toggles system prompt visibility on click', () => {
    render(
      <ContextStats
        tokenCount={makeTokenCount()}
        onClose={vi.fn()}
        systemPrompt="Hidden text"
      />,
    );
    const btn = screen.getByText(/System Prompt/);
    fireEvent.click(btn);
    expect(screen.getByText('Hidden text')).toBeInTheDocument();
  });

  it('shows sanitized raw context details when provided', () => {
    render(
      <ContextStats
        tokenCount={makeTokenCount()}
        onClose={vi.fn()}
        rawContext={{
          contextLimit: 32000,
          systemPromptChars: 1234,
          activeToolNames: ['fs_read'],
          history: [
            { id: 'm1', role: 'user', textChars: 12 },
            { id: 'm2', role: 'assistant', textChars: 400000, preview: 'large result preview' },
          ],
          imageCount: 1,
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /raw context/i }));

    expect(screen.getByTestId('context-stats-raw')).toHaveTextContent('"systemPromptChars": 1234');
    expect(screen.getByTestId('context-stats-raw')).toHaveTextContent('"textChars": 400000');
    expect(screen.getByTestId('context-stats-raw')).toHaveTextContent('large result preview');
  });
});
