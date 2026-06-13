import type { ConversationTitleSettings } from '@kalio/types';

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
    <div className="rounded-lg border border-base-300 bg-base-100/60 p-4">
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

      <div className="mt-4 border-t border-base-300 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-base-content/60">Rename every completed assistant replies</span>
          <span className="badge badge-neutral font-mono text-xs" data-testid="conversation-title-rename-every-value">
            {settings.renameEveryReplies}
          </span>
        </div>
        <input
          type="range"
          className="range range-sm range-primary w-full"
          min={1}
          max={10}
          step={1}
          value={settings.renameEveryReplies}
          disabled={loading || !settings.autoRenameEnabled}
          onChange={(event) => void onPatchSettings({ renameEveryReplies: parseInt(event.target.value, 10) })}
          data-testid="conversation-title-rename-every-slider"
        />
        <div className="mt-1 flex justify-between px-1 text-[10px] text-base-content/40">
          <span>1</span><span>3</span><span>5</span><span>10</span>
        </div>
      </div>
    </div>
  );
}
