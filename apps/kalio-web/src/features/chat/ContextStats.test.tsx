import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextStats } from './ContextStats';
import type { TokenCount } from '../../services/tokenCounter';
import type { LLMContextPreview } from '@kalio/types';

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
    const preview: LLMContextPreview = {
      sessionId: 'sid',
      personaId: 'persona-1',
      model: 'mimo-v2.5',
      contextLimit: 32000,
      estimatedTokens: {
        total: 1000,
        systemPrompt: 200,
        tools: 100,
        history: 650,
        images: 0,
        reasoning: 50,
      },
      compaction: {
        applied: true,
        unboundedMessageCount: 8,
        finalMessageCount: 4,
        safeTargetTokens: 25600,
      },
      effectiveSystemPrompt: 'Persona base\n\n## Active skills\nKeep a delegation ledger.',
      tools: [
        { name: 'vfs_read', description: 'Read file', parameters: {}, requiresConfirmation: false },
      ],
      messages: [
        { role: 'system', content: 'Persona base', source: 'system_prompt', estimatedTokens: 20 },
        {
          role: 'assistant',
          content: 'tool call wrapper',
          source: 'history',
          estimatedTokens: 12,
          toolCalls: [{ id: 'call-1', name: 'vfs_read', args: { path: 'README.md' } }],
        },
        { role: 'tool', content: '{"ok":true}', source: 'history', estimatedTokens: 6, toolCallId: 'call-1' },
        { role: 'user', content: 'draft question', source: 'draft', estimatedTokens: 4 },
      ],
    };

    render(
      <ContextStats
        tokenCount={makeTokenCount()}
        onClose={vi.fn()}
        contextPreview={preview}
        contextPreviewStatus={{ loading: false, stale: false, error: null }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /llm payload preview/i }));

    expect(screen.getByTestId('context-preview-panel')).toHaveTextContent('Effective system prompt');
    expect(screen.getByTestId('context-preview-panel')).toHaveTextContent('Messages sent to model');
    expect(screen.getByTestId('context-preview-panel')).toHaveTextContent('draft question');
    expect(screen.getByTestId('context-preview-panel')).toHaveTextContent('vfs_read');
    expect(screen.getByTestId('context-preview-panel')).toHaveTextContent('call-1');
    expect(screen.getByTestId('context-preview-panel')).toHaveTextContent('README.md');
    expect(screen.getByTestId('context-preview-panel')).toHaveTextContent('8 -> 4');
  });

  it('shows stale and error states for backend context preview', () => {
    render(
      <ContextStats
        tokenCount={makeTokenCount()}
        onClose={vi.fn()}
        contextPreview={null}
        contextPreviewStatus={{ loading: false, stale: true, error: 'Preview failed' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /llm payload preview/i }));

    expect(screen.getByTestId('context-preview-panel')).toHaveTextContent('stale');
    expect(screen.getByTestId('context-preview-panel')).toHaveTextContent('Preview failed');
  });
});
