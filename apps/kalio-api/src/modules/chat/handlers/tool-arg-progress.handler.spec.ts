import { describe, expect, it, vi } from 'vitest';
import { ToolArgProgressHandler } from './tool-arg-progress.handler';

describe('ToolArgProgressHandler', () => {
  it('emits tool arg progress updates with the active session id', async () => {
    const handler = new ToolArgProgressHandler();
    const emit = vi.fn();

    await expect(handler.handle(
      {
        type: 'tool_arg_progress',
        toolName: 'run_cli_agent',
        totalChars: 321,
        charsPerSec: 12.5,
      },
      {
        emit,
        sessionId: 'session-1',
      } as never,
    )).resolves.toBeUndefined();

    expect(handler.chunkType).toBe('tool_arg_progress');
    expect(emit).toHaveBeenCalledWith('tool:arg_progress', {
      toolName: 'run_cli_agent',
      totalChars: 321,
      charsPerSec: 12.5,
      sessionId: 'session-1',
    });
  });
});
