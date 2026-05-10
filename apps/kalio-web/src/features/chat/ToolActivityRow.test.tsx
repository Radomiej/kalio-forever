import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ToolActivity } from '../../store/agentStore';
import { ToolActivityRow } from './ToolActivityRow';

function makeActivity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    callId: 'call-1',
    toolName: 'web_search',
    args: {},
    status: 'running',
    startedAt: 1_000,
    ...overrides,
  };
}

describe('ToolActivityRow', () => {
  it('renders status labels and elapsed duration', () => {
    render(
      <ToolActivityRow
        activity={makeActivity({
          status: 'success',
          finishedAt: 2_500,
        })}
      />,
    );

    expect(screen.getByTestId('tool-activity-row')).toHaveAttribute('data-status', 'success');
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(screen.getByText('1.5s')).toBeInTheDocument();
  });

  it('expands and formats input arguments, including long values and nulls', () => {
    render(
      <ToolActivityRow
        activity={makeActivity({
          status: 'awaiting_confirmation',
          args: {
            query: 'x'.repeat(90),
            optional: null,
            meta: { nested: true },
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /toggle details/i }));

    expect(screen.getByText('waiting for confirmation')).toBeInTheDocument();
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('query')).toBeInTheDocument();
    expect(screen.getByTitle(`${'x'.repeat(80)}…`)).toBeInTheDocument();
    expect(screen.getByTitle('null')).toBeInTheDocument();
    expect(screen.getByTitle('{"nested":true}')).toBeInTheDocument();
  });

  it('renders string and JSON outputs in the expanded section', () => {
    const { rerender } = render(
      <ToolActivityRow
        activity={makeActivity({
          status: 'error',
          result: {
            callId: 'call-1',
            status: 'error',
            errorMessage: 'network down',
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /toggle details/i }));
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();

    rerender(
      <ToolActivityRow
        activity={makeActivity({
          status: 'cancelled',
          result: {
            callId: 'call-1',
            status: 'cancelled',
            data: { items: [1, 2, 3] },
          },
        })}
      />,
    );

    expect(screen.getByText(/"items": \[/)).toBeInTheDocument();
    expect(screen.getByText('cancelled')).toBeInTheDocument();
  });

  it('omits the details toggle when there is no input or output', () => {
    render(<ToolActivityRow activity={makeActivity({ status: 'running' })} />);

    expect(screen.queryByRole('button', { name: /toggle details/i })).not.toBeInTheDocument();
  });
});
