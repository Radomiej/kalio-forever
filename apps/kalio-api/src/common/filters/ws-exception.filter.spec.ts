import { describe, it, expect, vi } from 'vitest';
import { WsExceptionFilter } from './ws-exception.filter';
import { WsException } from '@nestjs/websockets';
import { ArgumentsHost } from '@nestjs/common';

function makeHost(emitMock: ReturnType<typeof vi.fn>): ArgumentsHost {
  return {
    switchToWs: () => ({
      getClient: () => ({ emit: emitMock }),
    }),
  } as unknown as ArgumentsHost;
}

describe('WsExceptionFilter', () => {
  it('handles WsException by emitting chat:error with message', () => {
    const filter = new WsExceptionFilter();
    const emit = vi.fn();
    const host = makeHost(emit);

    filter.catch(new WsException('something went wrong'), host);

    expect(emit).toHaveBeenCalledWith('chat:error', { message: 'something went wrong' });
  });

  it('handles plain Error by emitting chat:error with error message', () => {
    const filter = new WsExceptionFilter();
    const emit = vi.fn();
    const host = makeHost(emit);

    filter.catch(new Error('plain error'), host);

    expect(emit).toHaveBeenCalledWith('chat:error', { message: 'plain error' });
  });

  it('handles WsException with object payload', () => {
    const filter = new WsExceptionFilter();
    const emit = vi.fn();
    const host = makeHost(emit);
    const wsEx = new WsException({ status: 'error', message: 'bad payload' });

    filter.catch(wsEx, host);

    expect(emit).toHaveBeenCalledWith('chat:error', { message: '[object Object]' });
  });
});
