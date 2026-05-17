import { Injectable, Logger } from '@nestjs/common';
import { TelegramRelayService } from './telegram/telegram-relay.service';
import { RemoteRelayChannel } from './remote-relay-channel.interface';

/**
 * Aggregates all RemoteRelayChannel implementations and provides a single
 * broadcast() method for sending notifications across all connected channels.
 */
@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);

  constructor(private readonly telegram: TelegramRelayService) {}

  private get channels(): RemoteRelayChannel[] {
    return [this.telegram];
  }

  /**
   * Send text to every currently connected channel.
   * Returns true if at least one channel received the message.
   * Individual channel failures are logged but do not propagate.
   */
  async broadcast(text: string): Promise<boolean> {
    const connected = this.channels.filter((c) => c.isConnected);
    if (connected.length === 0) return false;
    await Promise.all(
      connected.map((c) =>
        c.sendMessage(text).catch((err: unknown) => {
          this.logger.error(
            `[RelayService] Channel ${c.id} failed to send message`,
            err instanceof Error ? err : new Error(String(err)),
          );
        }),
      ),
    );
    return true;
  }

  getConnected(): RemoteRelayChannel[] {
    return this.channels.filter((c) => c.isConnected);
  }
}
