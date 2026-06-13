import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from './settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      backendConfig: null,
      conversationTitleSettings: {
        autoRenameEnabled: false,
        renameEveryReplies: 3,
      },
    });
  });

  it('returns safe defaults before backend config is loaded', () => {
    const state = useSettingsStore.getState();

    expect(state.getEffectiveModel()).toBe('');
    expect(state.getEffectiveContextWindow()).toBe(32000);
    expect(state.conversationTitleSettings).toEqual({
      autoRenameEnabled: false,
      renameEveryReplies: 3,
    });
  });

  it('stores backend config and derives effective values from it', () => {
    useSettingsStore.getState().setBackendConfig({
      provider: 'openai',
      model: 'gpt-4.1',
      baseUrl: 'https://api.example.com',
      contextWindowSize: 128000,
      maxToolAttempts: 4,
      source: 'db',
    });

    const state = useSettingsStore.getState();

    expect(state.backendConfig).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1',
      contextWindowSize: 128000,
    });
    expect(state.getEffectiveModel()).toBe('gpt-4.1');
    expect(state.getEffectiveContextWindow()).toBe(128000);
  });

  it('stores conversation title settings for cross-panel sync', () => {
    useSettingsStore.getState().setConversationTitleSettings({
      autoRenameEnabled: true,
      renameEveryReplies: 5,
    });

    expect(useSettingsStore.getState().conversationTitleSettings).toEqual({
      autoRenameEnabled: true,
      renameEveryReplies: 5,
    });
  });
});
