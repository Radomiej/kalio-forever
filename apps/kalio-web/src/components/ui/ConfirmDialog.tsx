interface ConfirmDialogProps {
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, description, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div data-testid="confirm-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="card w-96 bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 data-testid="confirm-dialog-title" className="card-title">
            {title}
          </h2>
          <p data-testid="confirm-dialog-description" className="text-sm text-base-content/70">
            {description}
          </p>
          <div className="card-actions mt-4 justify-end gap-2">
            <button
              data-testid="confirm-dialog-cancel"
              className="btn btn-ghost btn-sm"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              data-testid="confirm-dialog-ok"
              className="btn btn-error btn-sm"
              onClick={onConfirm}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
