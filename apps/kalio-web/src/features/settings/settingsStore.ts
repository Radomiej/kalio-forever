/**
 * Settings store — in-memory only.
 * Caches the backend LLM config fetched on mount. No localStorage.
 * All configuration lives in the backend (credentials table + app_settings).
 */
import { create } from 'zustand';
import type { ConversationTitleSettings } from '@kalio/types';
import type { LLMConfigWithSource } from './llm-panel.types';

export type BackendLLMConfig = LLMConfigWithSource;

const DEFAULT_CONVERSATION_TITLE_SETTINGS: ConversationTitleSettings = {
  autoRenameEnabled: false,
  renameEveryReplies: 3,
};

interface SettingsState {
  /** Config fetched from /api/llm/config — reflects what backend is actually using */
  backendConfig: BackendLLMConfig | null;
  conversationTitleSettings: ConversationTitleSettings;
  setBackendConfig: (cfg: BackendLLMConfig) => void;
  setConversationTitleSettings: (settings: ConversationTitleSettings) => void;
  /** Returns model from backend config, or '' if not loaded yet */
  getEffectiveModel: () => string;
  /** Returns context window from backend config, or 32000 default */
  getEffectiveContextWindow: () => number;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  backendConfig: null,
  conversationTitleSettings: DEFAULT_CONVERSATION_TITLE_SETTINGS,

  setBackendConfig: (cfg) => set({ backendConfig: cfg }),
  setConversationTitleSettings: (conversationTitleSettings) => set({ conversationTitleSettings }),

  getEffectiveModel: () => get().backendConfig?.model ?? '',

  getEffectiveContextWindow: () => get().backendConfig?.contextWindowSize ?? 32000,
}));
