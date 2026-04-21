import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import type { ToolConfirmationRequest } from '@kalio/types';

interface ConfirmationDialogProps {
  request: ToolConfirmationRequest;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({ request, onConfirm, onCancel }: ConfirmationDialogProps) {
  const argsPreview = JSON.stringify(request.args, null, 2);
  return (
    <ConfirmDialog
      title={`Confirm: ${request.toolName}`}
      description={`Tool arguments:\n${argsPreview}`}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
