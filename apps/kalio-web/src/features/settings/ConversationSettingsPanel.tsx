import { useEffect, useRef, useState } from 'react';
import type { ConversationTitleSettings } from '@kalio/types';
import { apiClient } from '../../services/apiClient';
import { useSettingsStore } from './settingsStore';
import { ConversationTitleSettingsCard } from './ConversationTitleSettingsCard';

const DEFAULT_SETTINGS: ConversationTitleSettings = {
  autoRenameEnabled: false,
  renameEveryReplies: 3,
};

export function ConversationSettingsPanel() {
  const settings = useSettingsStore((state) => state.conversationTitleSettings);
  const setConversationTitleSettings = useSettingsStore((state) => state.setConversationTitleSettings);
  const [loading, setLoading] = useState(true);
  const latestRequestedSaveRef = useRef(0);
  const latestCommittedSaveRef = useRef(0);
  const committedSettingsRef = useRef<ConversationTitleSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    apiClient
      .get<ConversationTitleSettings>('/api/credentials/settings/conversation-title')
      .then(({ data }) => {
        committedSettingsRef.current = data;
        setConversationTitleSettings(data);
      })
      .catch((error: unknown) => console.error('[ConversationSettingsPanel] load failed', error))
      .finally(() => setLoading(false));
  }, [setConversationTitleSettings]);

  const patchSettings = async (patch: Partial<ConversationTitleSettings>) => {
    const saveId = latestRequestedSaveRef.current + 1;
    latestRequestedSaveRef.current = saveId;
    const next = { ...settings, ...patch };
    setConversationTitleSettings(next);
    try {
      await apiClient.put('/api/credentials/settings/conversation-title', patch);
      if (saveId >= latestCommittedSaveRef.current) {
        latestCommittedSaveRef.current = saveId;
        committedSettingsRef.current = next;
      }
    } catch (error: unknown) {
      console.error('[ConversationSettingsPanel] save failed', error);
      if (saveId === latestRequestedSaveRef.current) {
        setConversationTitleSettings(committedSettingsRef.current);
      }
    }
  };

  return (
    <section className="space-y-5" data-testid="conversation-settings-panel">
        <h2 className="text-lg font-semibold">Conversation</h2>

      <ConversationTitleSettingsCard
        loading={loading}
        settings={settings}
        onPatchSettings={patchSettings}
      />
    </section>
  );
}
