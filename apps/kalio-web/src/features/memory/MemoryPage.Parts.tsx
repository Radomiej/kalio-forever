import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { MemorySearchMode, MemorySearchResult } from '@kalio/types';

export function ModeButton({
  mode,
  current,
  onClick,
  label,
  icon,
}: {
  mode: MemorySearchMode;
  current: MemorySearchMode;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  const active = mode === current;
  return (
    <button
      className={`btn btn-sm gap-1 ${active ? 'btn-primary' : 'btn-ghost'}`}
      onClick={onClick}
      data-testid={`memory-mode-${mode}`}
    >
      {icon}
      {label}
    </button>
  );
}

export function ResultCard({
  result,
  index,
  onDelete,
  canDelete = true,
}: {
  result: MemorySearchResult;
  index: number;
  onDelete: () => void;
  canDelete?: boolean;
}) {
  const [expanded, setExpanded] = useState(index < 3);
  const metadataEntries = result.metadata
    ? Object.entries(result.metadata).map(([key, value]) => [key, String(value)] as const)
    : [];

  return (
    <div
      className="border border-base-300 rounded-lg bg-base-200/30 overflow-hidden"
      data-testid="memory-result"
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="badge badge-sm badge-primary">
              {(result.score * 100).toFixed(0)}%
            </span>
            <span className="text-xs text-base-content/40 font-mono">
              {new Date(result.createdAt).toLocaleDateString()}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="btn btn-ghost btn-xs p-1 h-6 w-6"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button
              className="btn btn-ghost btn-xs p-1 h-6 w-6 text-error hover:bg-error/10"
              onClick={onDelete}
              disabled={!canDelete}
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {expanded ? (
          <p className="mt-2 text-sm whitespace-pre-wrap">{result.content}</p>
        ) : (
          <p className="mt-2 text-sm line-clamp-2">{result.content}</p>
        )}

        {metadataEntries.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {metadataEntries.map(([key, value]) => (
              <span
                key={key}
                className="badge badge-xs badge-ghost"
                title={`${key}: ${value}`}
              >
                {key}: {value.slice(0, 20)}{value.length > 20 ? '...' : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
