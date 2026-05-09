import { Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch(WsException, Error)
export class WsExceptionFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  override catch(exception: WsException | Error, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();
    const message = exception instanceof WsException
      ? exception.getError()
      : exception.message;

    this.logger.error(`[WS] Unhandled exception: ${String(message)}`, exception instanceof Error ? exception.stack : undefined);

    // Must match KalioSDK.onError which listens on 'chat:error'
    client.emit('chat:error', { message: String(message) });
  }
}
