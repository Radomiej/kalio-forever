import { useEffect, useState } from 'react';
import type { ConversationTitleSettings } from '@kalio/types';
import { apiClient } from '../../services/apiClient';
import { ConversationTitleSettingsCard } from './ConversationTitleSettingsCard';

const DEFAULT_SETTINGS: ConversationTitleSettings = {
  autoRenameEnabled: false,
  renameEveryReplies: 3,
};

export function ConversationSettingsPanel() {
  const [settings, setSettings] = useState<ConversationTitleSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get<ConversationTitleSettings>('/api/credentials/settings/conversation-title')
      .then(({ data }) => setSettings(data))
      .catch((error: unknown) => console.error('[ConversationSettingsPanel] load failed', error))
      .finally(() => setLoading(false));
  }, []);

  const patchSettings = async (patch: Partial<ConversationTitleSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await apiClient.put('/api/credentials/settings/conversation-title', patch);
    } catch (error: unknown) {
      console.error('[ConversationSettingsPanel] save failed', error);
      setSettings(settings);
    }
  };

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-base-300 bg-base-200/10 p-4" data-testid="conversation-settings-panel">
      <div>
        <h3 className="text-sm font-semibold">Conversation</h3>
        <p className="text-xs text-base-content/60">
          Control automatic conversation renaming after agent replies.
        </p>
      </div>

      <ConversationTitleSettingsCard
        loading={loading}
        settings={settings}
        onPatchSettings={patchSettings}
      />
    </section>
  );
}
