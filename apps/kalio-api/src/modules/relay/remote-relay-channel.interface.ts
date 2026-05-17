/**
 * Abstract base for any out-of-band notification channel (Telegram, email, webhook, …).
 * Implementations are registered in RelayModule and aggregated by RelayService.
 */
export abstract class RemoteRelayChannel {
  abstract readonly id: string;
  abstract get isConnected(): boolean;
  /** Send a plain-text message to the channel. Must not throw if not connected. */
  abstract sendMessage(text: string): Promise<void>;
}
