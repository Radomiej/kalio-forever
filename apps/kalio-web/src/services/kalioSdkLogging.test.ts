import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolResult } from '@kalio/types';
import { KalioSDK } from '../../../../packages/@kalio/sdk/src/index';

type EventHandler = (payload: unknown) => void;

const socketMockState = vi.hoisted(() => {
  const handlers = new Map<string, EventHandler[]>();
  const socket = {
    on: vi.fn((event: string, handler: EventHandler) => {
      const current = handlers.get(event) ?? [];
      handlers.set(event, [...current, handler]);
    }),
    off: vi.fn((event: string, handler: EventHandler) => {
      const current = handlers.get(event) ?? [];
      handlers.set(event, current.filter((entry) => entry !== handler));
    }),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: true,
  };
  const io = vi.fn(() => socket);
  return { handlers, socket, io };
});

vi.mock('socket.io-client', () => ({
  io: socketMockState.io,
}));

function emit(event: string, payload: unknown): void {
  const handlers = socketMockState.handlers.get(event) ?? [];
  handlers.forEach((handler) => handler(payload));
}

describe('KalioSDK logging', () => {
  beforeEach(() => {
    socketMockState.handlers.clear();
    socketMockState.io.mockClear();
    socketMockState.socket.on.mockClear();
    socketMockState.socket.off.mockClear();
  });

  it('does not log INTERRUPTED chat errors through console.error', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleGroupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
    const consoleGroupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);

    const sdk = new KalioSDK({ wsUrl: 'http://localhost:3016' });
    const handler = vi.fn();
    sdk.onError(handler);

    emit('chat:error', {
      sessionId: 'session-1',
      code: 'INTERRUPTED',
      message: 'Turn interrupted by user',
      hadContent: false,
    });

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleGroupSpy).toHaveBeenCalledWith('[Thread] INTERRUPTED:', expect.objectContaining({
      code: 'INTERRUPTED',
    }));
    expect(consoleGroupEndSpy).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      code: 'INTERRUPTED',
    }));
  });

  it('does not log cancelled tool results through console.error', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleGroupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
    const consoleGroupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);

    const sdk = new KalioSDK({ wsUrl: 'http://localhost:3016' });
    const handler = vi.fn();
    sdk.onToolResult(handler);

    const payload: ToolResult = {
      callId: 'tool-1',
      status: 'cancelled',
    };
    emit('tool:result', payload);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleGroupSpy).toHaveBeenCalledWith('[Thread] OK TOOL RESULT: tool-1 -> cancelled');
    expect(consoleGroupEndSpy).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('still logs real tool errors through console.error', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const sdk = new KalioSDK({ wsUrl: 'http://localhost:3016' });
    const handler = vi.fn();
    sdk.onToolResult(handler);

    const payload: ToolResult = {
      callId: 'tool-2',
      status: 'error',
      errorCode: 'TOOL_EXECUTION_FAILED',
      errorMessage: 'Boom',
    };
    emit('tool:result', payload);

    expect(consoleErrorSpy).toHaveBeenCalledWith('[Thread] ERROR TOOL RESULT: tool-2 -> error');
    expect(consoleLogSpy).toHaveBeenCalledWith('errorCode:', 'TOOL_EXECUTION_FAILED');
    expect(consoleLogSpy).toHaveBeenCalledWith('errorMessage:', 'Boom');
    expect(handler).toHaveBeenCalledWith(payload);
  });
});
