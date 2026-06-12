import { AlertCircle } from 'lucide-react';

export function LLMPanelHeader({
  title = 'LLM Settings',
  description = 'Configure model behavior, runtime limits, and provider credentials. Active provider selection is stored in the database, and API keys remain write-only.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold mb-1">{title}</h2>
      <p className="text-xs text-base-content/60">{description}</p>
    </div>
  );
}

export function LLMPanelErrorAlert({ error, onClear }: { error: string; onClear: () => void }) {
  return (
    <div className="alert alert-warning py-2 text-xs gap-2">
      <AlertCircle size={14} />
      {error}
      <button className="btn btn-ghost btn-xs ml-auto" onClick={onClear}>x</button>
    </div>
  );
}
