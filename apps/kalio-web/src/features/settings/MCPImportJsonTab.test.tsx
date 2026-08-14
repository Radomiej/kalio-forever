import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MCPImportJsonTab } from './MCPImportJsonTab';

const validJson = JSON.stringify({
  mcpServers: {
    local: { command: 'node', args: ['server.js'], env: { TOKEN: 'secret' } },
    remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer token' } },
    skipped: { name: 'No transport' },
  },
});

describe('MCPImportJsonTab', () => {
  it('keeps parse disabled until JSON is entered and supports cancelling', () => {
    const onCancel = vi.fn();
    render(<MCPImportJsonTab onSubmit={vi.fn()} onCancel={onCancel} />);

    expect(screen.getByTestId('mcp-import-parse-btn')).toBeDisabled();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows parse errors for invalid and empty MCP definitions', () => {
    render(<MCPImportJsonTab onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const textarea = screen.getByTestId('mcp-import-json-textarea');

    fireEvent.change(textarea, { target: { value: '{invalid' } });
    fireEvent.click(screen.getByTestId('mcp-import-parse-btn'));
    expect(screen.getByTestId('mcp-import-parse-error')).toHaveTextContent('Invalid JSON');

    fireEvent.change(textarea, { target: { value: '{"mcpServers":{"empty":{}}}' } });
    fireEvent.click(screen.getByTestId('mcp-import-parse-btn'));
    expect(screen.getByTestId('mcp-import-parse-error')).toHaveTextContent('No valid server entries');
  });

  it('parses entries, toggles individual/all selection, and resets on edit', () => {
    render(<MCPImportJsonTab onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const textarea = screen.getByTestId('mcp-import-json-textarea');
    fireEvent.change(textarea, { target: { value: validJson } });
    fireEvent.click(screen.getByTestId('mcp-import-parse-btn'));

    expect(screen.getByTestId('mcp-import-entries')).toHaveTextContent('2 servers found');
    expect(screen.getByTestId('mcp-import-connect-btn')).toHaveTextContent('Connect (2)');
    fireEvent.click(screen.getByTestId('mcp-import-toggle-all'));
    expect(screen.getByTestId('mcp-import-connect-btn')).toBeDisabled();
    fireEvent.click(screen.getByTestId('mcp-import-toggle-all'));
    expect(screen.getByTestId('mcp-import-connect-btn')).toHaveTextContent('Connect (2)');
    fireEvent.click(screen.getByTestId('mcp-import-check-local'));
    expect(screen.getByTestId('mcp-import-connect-btn')).toHaveTextContent('Connect (1)');

    fireEvent.change(textarea, { target: { value: `${validJson} ` } });
    expect(screen.queryByTestId('mcp-import-entries')).toBeNull();
    expect(screen.getByTestId('mcp-import-parse-btn')).toBeInTheDocument();
  });

  it('reports per-server connection errors and closes after a clean retry', async () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('remote unavailable'))
      .mockResolvedValueOnce(undefined);
    render(<MCPImportJsonTab onSubmit={onSubmit} onCancel={onCancel} />);
    fireEvent.change(screen.getByTestId('mcp-import-json-textarea'), { target: { value: validJson } });
    fireEvent.click(screen.getByTestId('mcp-import-parse-btn'));

    fireEvent.click(screen.getByTestId('mcp-import-connect-btn'));
    expect(await screen.findByText('remote unavailable')).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('mcp-import-check-remote'));
    fireEvent.click(screen.getByTestId('mcp-import-connect-btn'));
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(3);
  });
});
