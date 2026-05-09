import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MCPAddServerForm } from './MCPAddServerForm';

describe('MCPAddServerForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a whitespace-only server name before submit (REGRESSION)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MCPAddServerForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByTestId('mcp-form-name'), '   ');
    await user.type(screen.getByTestId('mcp-form-url'), 'https://mcp.example.com/sse');
    await user.click(screen.getByTestId('mcp-form-submit'));

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it('rejects a whitespace-only HTTP URL before submit (REGRESSION)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MCPAddServerForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByTestId('mcp-form-name'), 'My MCP');
    await user.type(screen.getByTestId('mcp-form-url'), '   ');
    await user.click(screen.getByTestId('mcp-form-submit'));

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it('rejects a whitespace-only stdio command before submit (REGRESSION)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MCPAddServerForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByTestId('mcp-form-name'), 'My MCP');
    await user.click(screen.getByTestId('mcp-form-transport-stdio'));
    await user.type(screen.getByTestId('mcp-form-command'), '   ');
    await user.click(screen.getByTestId('mcp-form-submit'));

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it('preserves quoted stdio args as a single token (REGRESSION)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MCPAddServerForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByTestId('mcp-form-name'), 'My MCP');
    await user.click(screen.getByTestId('mcp-form-transport-stdio'));
    await user.type(screen.getByTestId('mcp-form-command'), 'npx');
    await user.type(screen.getByTestId('mcp-form-args'), '--root "C:\\Program Files\\Repo"');
    await user.click(screen.getByTestId('mcp-form-submit'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        args: ['--root', 'C:\\Program Files\\Repo'],
      }));
    });
  });

  it('preserves escaped quotes inside a quoted stdio arg (REGRESSION)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MCPAddServerForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByTestId('mcp-form-name'), 'My MCP');
    await user.click(screen.getByTestId('mcp-form-transport-stdio'));
    await user.type(screen.getByTestId('mcp-form-command'), 'npx');
    await user.type(screen.getByTestId('mcp-form-args'), '--message "She said \\"hello\\"" --flag');
    await user.click(screen.getByTestId('mcp-form-submit'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        args: ['--message', 'She said "hello"', '--flag'],
      }));
    });
  });
});