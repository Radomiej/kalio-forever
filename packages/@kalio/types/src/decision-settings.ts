/** Typed Decisions API settings, independent of the conversational LLM provider. */
export interface DecisionSettings {
  provider: 'openrouter' | 'typesafe' | 'custom';
  model: string;
  credentialId: string | null;
  /** Full POST URL for custom Decisions-compatible servers. */
  endpoint: string;
}

export interface DecisionConnection {
  endpoint: string;
  model: string;
  apiKey: string;
}

export const DECISION_SETTINGS = 'DECISION_SETTINGS';

export interface DecisionSettingsPort {
  getConfig(): Promise<DecisionSettings>;
  updateConfig(config: DecisionSettings): Promise<DecisionSettings>;
  resolve(): Promise<DecisionConnection>;
}
