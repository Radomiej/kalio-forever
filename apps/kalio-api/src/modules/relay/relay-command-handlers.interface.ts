/**
 * Command handlers injected into TelegramRelayService by ChatModule after
 * all providers are initialised. Keeps RelayModule free of ChatModule imports.
 */
export interface RelayCommandHandlers {
  stopAll(): Promise<void>;
  getStatus(): Promise<string>;
}
