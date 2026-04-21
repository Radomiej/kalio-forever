/**
 * Settings store — persists to localStorage.
 * Provides LLM provider configuration (can have multiple, one active).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LLMProviderType =
  | 'openai'
  | 'cometapi'
  | 'openrouter'
  | 'ollama'
  | 'xiaomimimo'
  | 'deepseek'
  | 'custom';

export interface LLMProvider {
  id: string;
  /** Backend credential ID (set after successful POST to /api/credentials) */
  backendId?: string;
  type: LLMProviderType;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const PROVIDER_DEFAULTS: Record<LLMProviderType, Pick<LLMProvider, 'label' | 'baseUrl'>> = {
  openai:      { label: 'OpenAI',      baseUrl: 'https://api.openai.com/v1' },
  cometapi:    { label: 'CometAPI',    baseUrl: 'https://api.cometapi.com/v1' },
  openrouter:  { label: 'OpenRouter',  baseUrl: 'https://openrouter.ai/api/v1' },
  ollama:      { label: 'Ollama',      baseUrl: 'http://localhost:11434/v1' },
  xiaomimimo:  { label: 'XiaomiMiMo', baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1' },
  deepseek:    { label: 'DeepSeek',    baseUrl: 'https://api.deepseek.com/v1' },
  custom:      { label: 'Custom',      baseUrl: '' },
};

export const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  openai:     'gpt-4o-mini',
  cometapi:   'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  ollama:     'llama3.2',
  xiaomimimo: 'mimo-v2-omni',
  deepseek:   'deepseek-reasoner',
  custom:     '',
};

export interface BackendLLMConfig {
  provider: string;
  model: string;
  baseUrl: string;
  contextWindowSize: number;
}

interface SettingsState {
  providers: LLMProvider[];
  activeProviderId: string | null;
  contextWindowSize: number;
  /** Config fetched from /api/llm/config — reflects what backend is actually using */
  backendConfig: BackendLLMConfig | null;
  addProvider: (p: Omit<LLMProvider, 'id'>) => string;
  updateProvider: (id: string, patch: Partial<Omit<LLMProvider, 'id' | 'backendId'> & Pick<LLMProvider, 'backendId'>>) => void;
  removeProvider: (id: string) => void;
  setActive: (id: string) => void;
  getActive: () => LLMProvider | undefined;
  setContextWindowSize: (size: number) => void;
  setBackendConfig: (cfg: BackendLLMConfig) => void;
  /** Returns active local provider model, or backend model, or '' */
  getEffectiveModel: () => string;
  /** Returns effective context window (local > backend > default) */
  getEffectiveContextWindow: () => number;
}

let _counter = 1;
function newId() { return `prov-${Date.now()}-${_counter++}`; }

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      providers: [],
      activeProviderId: null,
      contextWindowSize: 32000,
      backendConfig: null,

      addProvider: (p) => {
        const id = newId();
        set((s) => ({
          providers: [...s.providers, { ...p, id }],
          activeProviderId: s.activeProviderId ?? id,
        }));
        return id;
      },

      updateProvider: (id, patch) =>
        set((s) => ({
          providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),

      removeProvider: (id) =>
        set((s) => {
          const remaining = s.providers.filter((p) => p.id !== id);
          return {
            providers: remaining,
            activeProviderId:
              s.activeProviderId === id
                ? (remaining[0]?.id ?? null)
                : s.activeProviderId,
          };
        }),

      setActive: (id) => set({ activeProviderId: id }),

      getActive: () => {
        const { providers, activeProviderId } = get();
        return providers.find((p) => p.id === activeProviderId);
      },

      setContextWindowSize: (size) => set({ contextWindowSize: size }),

      setBackendConfig: (cfg) => set({ backendConfig: cfg }),

      getEffectiveModel: () => {
        const s = get();
        const localModel = s.providers.find((p) => p.id === s.activeProviderId)?.model;
        return localModel || s.backendConfig?.model || '';
      },

      getEffectiveContextWindow: () => {
        const s = get();
        return s.contextWindowSize || s.backendConfig?.contextWindowSize || 32000;
      },
    }),
    { name: 'kalio-settings' },
  ),
);
