import type { ConversationTitleSettings } from '@kalio/types';
import { SettingsRangeField } from './SettingsRangeField';

type ConversationTitleSettingsCardProps = {
  loading: boolean;
  settings: ConversationTitleSettings;
  onPatchSettings: (patch: Partial<ConversationTitleSettings>) => void | Promise<void>;
};

export function ConversationTitleSettingsCard({
  loading,
  settings,
  onPatchSettings,
}: ConversationTitleSettingsCardProps) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-100/60 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Active Change Conversation Title</div>
          <div className="text-xs text-base-content/55">
            Let the agent keep refining the chat title after more replies arrive.
          </div>
        </div>
        <input
          type="checkbox"
          className="toggle toggle-info"
          checked={settings.autoRenameEnabled}
          disabled={loading}
          onChange={(event) => void onPatchSettings({ autoRenameEnabled: event.target.checked })}
          data-testid="conversation-title-auto-rename-toggle"
        />
      </div>

      <div className="mt-5 border-t border-base-300 pt-5">
        <SettingsRangeField
          ariaLabel="Rename every completed assistant replies"
          disabled={loading || !settings.autoRenameEnabled}
          label="Rename every completed assistant replies"
          marks={[
            { value: 1, label: '1' },
            { value: 3, label: '3' },
            { value: 5, label: '5' },
            { value: 10, label: '10' },
          ]}
          min={1}
          max={10}
          step={1}
          value={settings.renameEveryReplies}
          valueLabel={settings.renameEveryReplies}
          valueTestId="conversation-title-rename-every-value"
          onChange={(event) => void onPatchSettings({ renameEveryReplies: parseInt(event.target.value, 10) })}
          testId="conversation-title-rename-every-slider"
        />
      </div>
    </div>
  );
}
