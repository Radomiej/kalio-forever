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
  | 'custom';

export interface LLMProvider {
  id: string;
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
  custom:      { label: 'Custom',      baseUrl: '' },
};

export const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  openai:     'gpt-4o-mini',
  cometapi:   'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  ollama:     'llama3.2',
  custom:     '',
};

interface SettingsState {
  providers: LLMProvider[];
  activeProviderId: string | null;
  addProvider: (p: Omit<LLMProvider, 'id'>) => string;
  updateProvider: (id: string, patch: Partial<Omit<LLMProvider, 'id'>>) => void;
  removeProvider: (id: string) => void;
  setActive: (id: string) => void;
  getActive: () => LLMProvider | undefined;
}

let _counter = 1;
function newId() { return `prov-${Date.now()}-${_counter++}`; }

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      providers: [],
      activeProviderId: null,

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
    }),
    { name: 'kalio-settings' },
  ),
);
