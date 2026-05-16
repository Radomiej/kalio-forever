/**
 * RAAppGroupCard — displays a versioned user RA-App group with:
 *   - Current version badge
 *   - Draft banner with Approve (+patch / +minor / +major) and Discard buttons
 *   - Collapsible version history list with Rollback per entry
 *   - Run / Delete action buttons
 */
import { useState, useCallback } from 'react';
import {
  Play,
  Trash2,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Download,
  XCircle,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import type { RAAppGroup } from '@kalio/types';

export interface RAAppGroupCardProps {
  group: RAAppGroup;
  onRun: (slug: string) => void;
  onDelete: (slug: string) => void;
  onApprove: (slug: string, bumpType: 'patch' | 'minor' | 'major') => Promise<void>;
  onDiscardDraft: (slug: string) => Promise<void>;
  onRollback: (slug: string, version: string) => Promise<void>;
  onDownloadVersion?: (slug: string, version: string) => void;
}

export function RAAppGroupCard({
  group,
  onRun,
  onDelete,
  onApprove,
  onDiscardDraft,
  onRollback,
  onDownloadVersion,
}: RAAppGroupCardProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleApprove = useCallback(
    async (bumpType: 'patch' | 'minor' | 'major') => {
      setApproving(true);
      setActionError(null);
      try {
        await onApprove(group.slug, bumpType);
      } catch (err) {
        setActionError(`Approve failed: ${(err as Error).message}`);
      } finally {
        setApproving(false);
      }
    },
    [group.slug, onApprove],
  );

  const handleDiscard = useCallback(async () => {
    setDiscarding(true);
    setActionError(null);
    try {
      await onDiscardDraft(group.slug);
    } catch (err) {
      setActionError(`Discard failed: ${(err as Error).message}`);
    } finally {
      setDiscarding(false);
    }
  }, [group.slug, onDiscardDraft]);

  const handleRollback = useCallback(
    async (version: string) => {
      setRollingBack(version);
      setActionError(null);
      try {
        await onRollback(group.slug, version);
      } catch (err) {
        setActionError(`Rollback failed: ${(err as Error).message}`);
      } finally {
        setRollingBack(null);
      }
    },
    [group.slug, onRollback],
  );

  const { current, draft, history } = group;

  const handleDelete = useCallback(() => {
    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm(`Delete RA-App group "${current.meta.name}"? This removes current, draft, and history versions.`);
    if (!confirmed) {
      return;
    }
    onDelete(group.slug);
  }, [current.meta.name, group.slug, onDelete]);

  return (
    <div
      className="bg-base-200 rounded-lg p-3 flex flex-col gap-2"
      data-testid={`raapp-group-${group.slug}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold text-base-content truncate">{current.meta.name}</p>
            <span
              className="badge badge-xs badge-success text-[10px]"
              data-testid={`raapp-group-version-${group.slug}`}
            >
              v{current.version}
            </span>
          </div>
          {current.meta.description && (
            <p className="text-xs text-base-content/50 line-clamp-2 mt-0.5">{current.meta.description}</p>
          )}
          {current.meta.tags && current.meta.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {current.meta.tags.map((tag) => (
                <span key={tag} className="badge badge-xs badge-ghost">{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Draft banner */}
      {draft && (
        <div
          className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 flex flex-col gap-1.5"
          data-testid={`raapp-draft-${group.slug}`}
        >
          <div className="flex items-center gap-1.5">
            <AlertCircle size={11} className="text-warning shrink-0" />
            <span className="text-[11px] font-medium text-warning">
              Draft ready — v{draft.meta.version}
            </span>
          </div>
          <div className="flex gap-1 flex-wrap">
            <button
              className="btn btn-xs btn-warning gap-1"
              onClick={() => handleApprove('minor')}
              disabled={approving}
              data-testid={`raapp-approve-minor-${group.slug}`}
              title="Approve as minor version bump"
            >
              <CheckCircle size={10} />
              {approving ? 'Approving…' : '+minor'}
            </button>
            <button
              className="btn btn-xs btn-warning btn-outline gap-1"
              onClick={() => handleApprove('patch')}
              disabled={approving}
              title="Approve as patch bump"
            >
              +patch
            </button>
            <button
              className="btn btn-xs btn-warning btn-outline gap-1"
              onClick={() => handleApprove('major')}
              disabled={approving}
              title="Approve as major version bump"
            >
              +major
            </button>
            <button
              className="btn btn-xs btn-ghost gap-1 ml-auto"
              onClick={handleDiscard}
              disabled={discarding}
              data-testid={`raapp-discard-${group.slug}`}
            >
              <XCircle size={10} />
              {discarding ? 'Discarding…' : 'Discard'}
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <button
            className="flex items-center gap-1 text-[11px] text-base-content/40 hover:text-base-content/70 transition-colors"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            {historyOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            History ({history.length})
          </button>
          {historyOpen && (
            <div className="mt-1 flex flex-col gap-1 pl-2 border-l border-base-300">
              {history.map((entry) => (
                <div key={entry.version} className="flex items-center gap-2 text-[11px] text-base-content/50">
                  <span className="flex-1">v{entry.version}</span>
                  {onDownloadVersion && (
                    <button
                      className="btn btn-xs btn-ghost gap-1 py-0 h-auto"
                      onClick={() => onDownloadVersion(group.slug, entry.version)}
                      data-testid={`raapp-download-history-${group.slug}-${entry.version}`}
                      title={`Download v${entry.version}`}
                    >
                      <Download size={9} />
                      Download
                    </button>
                  )}
                  <button
                    className="btn btn-xs btn-ghost gap-1 py-0 h-auto"
                    onClick={() => handleRollback(entry.version)}
                    disabled={rollingBack !== null || !!draft}
                    title={draft ? 'Discard current draft before rolling back' : `Rollback to v${entry.version}`}
                  >
                    <RotateCcw size={9} />
                    {rollingBack === entry.version ? '…' : 'Rollback'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {actionError && (
        <p className="text-[10px] text-error">{actionError}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 mt-auto pt-1 border-t border-base-300">
        <button
          className="btn btn-xs btn-primary flex-1 gap-1"
          onClick={() => onRun(group.slug)}
          data-testid={`raapp-run-${group.slug}`}
        >
          <Play size={10} />
          Run
        </button>
        {onDownloadVersion && (
          <button
            className="btn btn-xs btn-ghost gap-1"
            onClick={() => onDownloadVersion(group.slug, current.version)}
            data-testid={`raapp-download-current-${group.slug}`}
            title={`Download current release v${current.version}`}
          >
            <Download size={10} />
          </button>
        )}
        <button
          className="btn btn-xs btn-ghost text-error/70 hover:text-error"
          onClick={handleDelete}
          data-testid={`raapp-delete-${group.slug}`}
          title="Delete this RA-App group"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
