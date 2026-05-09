/**
 * Settings store — in-memory only.
 * Caches the backend LLM config fetched on mount. No localStorage.
 * All configuration lives in the backend (credentials table + app_settings).
 */
import { create } from 'zustand';

export interface BackendLLMConfig {
  provider: string;
  model: string;
  baseUrl: string;
  contextWindowSize: number;
  maxToolAttempts: number;
}

interface SettingsState {
  /** Config fetched from /api/llm/config — reflects what backend is actually using */
  backendConfig: BackendLLMConfig | null;
  setBackendConfig: (cfg: BackendLLMConfig) => void;
  /** Returns model from backend config, or '' if not loaded yet */
  getEffectiveModel: () => string;
  /** Returns context window from backend config, or 32000 default */
  getEffectiveContextWindow: () => number;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  backendConfig: null,

  setBackendConfig: (cfg) => set({ backendConfig: cfg }),

  getEffectiveModel: () => get().backendConfig?.model ?? '',

  getEffectiveContextWindow: () => get().backendConfig?.contextWindowSize ?? 32000,
}));
