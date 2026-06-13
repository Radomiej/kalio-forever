import { BrainCircuit } from 'lucide-react';

export function PersonaPageState({
  title,
  body,
  actionLabel,
  onAction,
  tone = 'neutral',
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'neutral' | 'error';
}) {
  const isError = tone === 'error';

  return (
    <section className={`flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center ${isError ? 'border-error/30 bg-error/10' : 'border-base-300 bg-base-200/40'}`}>
      <BrainCircuit size={28} className={isError ? 'text-error/60' : 'text-base-content/20'} />
      <p className={`mt-3 text-sm font-medium ${isError ? 'text-error' : 'text-base-content/65'}`}>{title}</p>
      <p className={`mt-1 max-w-md text-xs ${isError ? 'text-error/70' : 'text-base-content/40'}`}>{body}</p>
      {actionLabel && onAction && (
        <button className={`btn btn-sm mt-4 gap-2 ${isError ? 'btn-outline btn-error' : 'btn-primary'}`} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </section>
  );
}
