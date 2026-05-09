/**
 * RAAppCoreCard — read-only catalog card for RA-Apps.
 * Shows name, version, description, tags and a Run button.
 */
import { Play } from 'lucide-react';
import type { RAAppSummary } from '@kalio/types';

export interface RAAppCoreCardProps {
  app: RAAppSummary;
  onRun: (name: string) => void;
}

export function RAAppCoreCard({ app, onRun }: RAAppCoreCardProps) {
  return (
    <div
      className="bg-base-200 rounded-lg p-3 flex flex-col gap-2"
      data-testid={`raapp-catalog-${app.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold text-base-content truncate">{app.name}</p>
          <span className="badge badge-xs badge-ghost text-[10px]">v{app.version}</span>
          <span className="badge badge-xs badge-ghost text-[10px]">{app.source}</span>
        </div>
        {app.description && (
          <p className="text-xs text-base-content/50 line-clamp-2 mt-0.5">{app.description}</p>
        )}
        {app.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {app.tags.map((tag) => (
              <span key={tag} className="badge badge-xs badge-ghost">{tag}</span>
            ))}
          </div>
        )}
      </div>
      <div className="pt-1 border-t border-base-300">
        <button
          className="btn btn-xs btn-primary w-full gap-1"
          onClick={() => onRun(app.name)}
          data-testid={`raapp-catalog-run-${app.id}`}
        >
          <Play size={10} />
          Run
        </button>
      </div>
    </div>
  );
}
