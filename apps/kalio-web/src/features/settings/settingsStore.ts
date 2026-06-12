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
  requestedSettingsTab: string | null;
  runtimeModelFocusRequest: number;
  setBackendConfig: (cfg: BackendLLMConfig) => void;
  setConversationTitleSettings: (settings: ConversationTitleSettings) => void;
  requestSettingsTab: (tabId: string) => void;
  clearRequestedSettingsTab: () => void;
  requestRuntimeModelFocus: () => void;
  clearRuntimeModelFocusRequest: () => void;
  /** Returns model from backend config, or '' if not loaded yet */
  getEffectiveModel: () => string;
  /** Returns context window from backend config, or 32000 default */
  getEffectiveContextWindow: () => number;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  backendConfig: null,
  conversationTitleSettings: DEFAULT_CONVERSATION_TITLE_SETTINGS,
  requestedSettingsTab: null,
  runtimeModelFocusRequest: 0,

  setBackendConfig: (cfg) => set({ backendConfig: cfg }),
  setConversationTitleSettings: (conversationTitleSettings) => set({ conversationTitleSettings }),
  requestSettingsTab: (tabId) => set({ requestedSettingsTab: tabId }),
  clearRequestedSettingsTab: () => set({ requestedSettingsTab: null }),
  requestRuntimeModelFocus: () => set((state) => ({ runtimeModelFocusRequest: state.runtimeModelFocusRequest + 1 })),
  clearRuntimeModelFocusRequest: () => set({ runtimeModelFocusRequest: 0 }),

  getEffectiveModel: () => get().backendConfig?.model ?? '',

  getEffectiveContextWindow: () => get().backendConfig?.contextWindowSize ?? 32000,
}));
