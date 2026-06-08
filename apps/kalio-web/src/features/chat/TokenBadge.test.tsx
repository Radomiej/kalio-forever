import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TokenBadge } from './TokenBadge';
import type { TokenCount } from '../../services/tokenCounter';

function tokenCount(overrides: Partial<TokenCount> = {}): TokenCount {
  return {
    total: 1234,
    breakdown: {
      systemPrompt: 100,
      skills: 50,
      tools: 25,
      history: 1059,
      images: 0,
    },
    cacheable: 175,
    contextLimit: 2000,
    usagePercent: 62,
    ...overrides,
  };
}

describe('TokenBadge', () => {
  it('formats the token counts and triggers the click handler', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<TokenBadge tokenCount={tokenCount()} onClick={onClick} />);

    const badge = screen.getByTestId('token-badge');
    expect(badge).toHaveTextContent('~1.2k/2.0k');
    expect(badge).toHaveAttribute(
      'title',
      expect.stringMatching(/^Context usage: ~1,?234 \/ 2,?000 tokens \(62%\)$/),
    );
    expect(badge).toHaveClass('badge-ghost');

    await user.click(badge);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('switches tone at the warning and error thresholds', () => {
    const { rerender } = render(<TokenBadge tokenCount={tokenCount({ usagePercent: 79 })} />);
    expect(screen.getByTestId('token-badge')).toHaveClass('badge-ghost');

    rerender(<TokenBadge tokenCount={tokenCount({ usagePercent: 80 })} />);
    expect(screen.getByTestId('token-badge')).toHaveClass('badge-warning');

    rerender(<TokenBadge tokenCount={tokenCount({ usagePercent: 95 })} />);
    expect(screen.getByTestId('token-badge')).toHaveClass('badge-error');
  });
});
