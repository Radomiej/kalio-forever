import { Loader2 } from 'lucide-react';

interface ArchitectVariantDialogProps {
  description: string;
  name: string;
  saving: boolean;
  onCancel: () => void;
  onDescriptionChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onSave: () => void;
}

export function ArchitectVariantDialog({
  description,
  name,
  saving,
  onCancel,
  onDescriptionChange,
  onNameChange,
  onSave,
}: ArchitectVariantDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-base-300 bg-base-100 p-4 shadow-xl">
        <div className="text-sm font-semibold text-base-content">Save architecture variant</div>
        <div className="mt-4 form-control gap-1">
          <label className="label-text text-xs font-semibold text-base-content/70">Name</label>
          <input
            className="input input-bordered input-sm"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            data-testid="architect-variant-name-input"
          />
        </div>
        <div className="mt-3 form-control gap-1">
          <label className="label-text text-xs font-semibold text-base-content/70">Description</label>
          <textarea
            className="textarea textarea-bordered min-h-24 text-sm"
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            data-testid="architect-variant-description-input"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm gap-2"
            onClick={onSave}
            disabled={saving || !name.trim()}
            data-testid="architect-confirm-save-variant"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
