/** Typed Decisions API settings, independent of the conversational LLM provider. */
export type DecisionPurpose = 'tools' | 'goals';

export interface DecisionSettings {
  provider: 'openrouter' | 'typesafe' | 'custom' | 'ollama';
  model: string;
  credentialId: string | null;
  /** Full POST URL for custom Decisions-compatible servers. */
  endpoint: string;
}

export type DecisionConnection =
  | { protocol: 'jev-decisions'; endpoint: string; model: string; apiKey: string }
  | { protocol: 'ollama-chat'; endpoint: string; model: string; revision: number; apiKey?: never };

export const DECISION_SETTINGS = 'DECISION_SETTINGS';

export interface DecisionSettingsPort {
  /** Omitted purpose preserves the legacy goals configuration. */
  getConfig(purpose?: DecisionPurpose): Promise<DecisionSettings>;
  updateConfig(config: DecisionSettings, purpose?: DecisionPurpose): Promise<DecisionSettings>;
  resolve(purpose?: DecisionPurpose): Promise<DecisionConnection>;
}
