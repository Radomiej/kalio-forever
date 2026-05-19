import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryToolCallBubble, extractRAAppBlock } from './ToolCallBubble';

vi.mock('../raapp/RAAppRenderer', () => ({
  RAAppRenderer: ({ block }: { block: { type: string } }) => (
    <div data-testid="raapp-renderer" data-type={block.type}>RA-App Widget</div>
  ),
}));

const GUI_TOOL_RESULT = JSON.stringify({
  status: 'ready',
  type: 'gui',
  mode: 'interactive',
  content: '{"nodes":[],"data":{}}',
});

const NON_RAAPP_RESULT = JSON.stringify({ status: 'ok', items: [] });

describe('REGRESSION: HistoryToolCallBubble RA-App widget inside chip', () => {
  it('preserves vfsPath when extracting html RA-App blocks', () => {
    const block = extractRAAppBlock({
      status: 'ready',
      type: 'html',
      mode: 'display',
      content: '',
      vfsPath: 'design/preview.html',
    });

    expect(block).toMatchObject({
      type: 'html',
      mode: 'display',
      content: '',
      vfsPath: 'design/preview.html',
    });
  });

  it('preserves nativeResults when extracting RA-App blocks', () => {
    const block = extractRAAppBlock({
      status: 'ready',
      type: 'gui',
      mode: 'display',
      content: '{"nodes":[],"data":{}}',
      nativeResults: [
        {
          id: 'native-1',
          system: 'vfs_write',
          status: 'executed',
          result: { path: 'drafts/result.txt' },
        },
      ],
    });

    expect(block).toMatchObject({
      nativeResults: [
        expect.objectContaining({ system: 'vfs_write', status: 'executed' }),
      ],
    });
  });

  it('renders RAAppRenderer when content has RA-App block', () => {
    render(<HistoryToolCallBubble toolName="run_raapp" content={GUI_TOOL_RESULT} isAnswered={false} />);
    expect(screen.getByTestId('raapp-renderer')).toBeInTheDocument();
  });

  it('does not render RAAppRenderer for non-RA-App content', () => {
    render(<HistoryToolCallBubble toolName="list_raapps" content={NON_RAAPP_RESULT} />);
    expect(screen.queryByTestId('raapp-renderer')).not.toBeInTheDocument();
  });

  it('hides widget and shows freeze text when isAnswered=true', () => {
    render(<HistoryToolCallBubble toolName="run_raapp" content={GUI_TOOL_RESULT} isAnswered={true} />);
    expect(screen.queryByTestId('raapp-renderer')).not.toBeInTheDocument();
    expect(screen.getByText(/Interactive app/)).toBeInTheDocument();
  });

  it('shows answered badge when isAnswered=true', () => {
    render(<HistoryToolCallBubble toolName="run_raapp" content={GUI_TOOL_RESULT} isAnswered={true} />);
    expect(screen.getByText(/answered/)).toBeInTheDocument();
  });

  it('collapses widget when isAnswered flips from false to true', () => {
    const { rerender } = render(
      <HistoryToolCallBubble toolName="run_raapp" content={GUI_TOOL_RESULT} isAnswered={false} />,
    );
    expect(screen.getByTestId('raapp-renderer')).toBeInTheDocument();

    act(() => {
      rerender(<HistoryToolCallBubble toolName="run_raapp" content={GUI_TOOL_RESULT} isAnswered={true} />);
    });

    expect(screen.queryByTestId('raapp-renderer')).not.toBeInTheDocument();
    expect(screen.getByText(/Interactive app/)).toBeInTheDocument();
  });
});
