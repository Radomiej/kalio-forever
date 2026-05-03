/**
 * RAAppManager — dual-source RA-App browser.
 *
 * Two sections:
 *  1. Catalog  — stored apps fetched from /api/ra-apps (core + versioned user)
 *  2. Session  — inline apps created by raapp_create in the current chat session
 */
import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Code2, Globe, Eye, RefreshCw, Upload, Package } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { RAAppRenderer } from './RAAppRenderer';
import { RAAppGroupCard } from './components/RAAppGroupCard';
import { RAAppCoreCard } from './components/RAAppCoreCard';
import { bucketCatalogApps } from './catalog.utils';
import {
  getRAApps,
  getRAAppGroups,
  uploadRAApp,
  approveRAAppDraft,
  discardRAAppDraft,
  rollbackRAApp,
  deleteRAAppGroup,
} from '../../services/apiClient';
import type { RAAppBlock, RAAppSummary, RAAppGroup } from '@kalio/types';

interface FoundRAApp {
  messageId: string;
  block: RAAppBlock;
  index: number;
}

export function RAAppManager({ onOpenVFS, onRunWithAgent }: { onOpenVFS: (appId: string) => void; onRunWithAgent: () => void }) {
  void onOpenVFS;

  // ── Catalog state ────────────────────────────────────────────────────────
  const [groups, setGroups] = useState<RAAppGroup[]>([]);
  const [coreApps, setCoreApps] = useState<RAAppSummary[]>([]);
  const [userStandaloneApps, setUserStandaloneApps] = useState<RAAppSummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Session state ────────────────────────────────────────────────────────
  const messages = useSessionStore((s) => s.messages);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // ── Derive session inline apps from messages ─────────────────────────────
  const sessionApps = useMemo<FoundRAApp[]>(() => {
    const found: FoundRAApp[] = [];
    let idx = 0;
    for (const msg of messages) {
      if (msg.role !== 'tool_result' || !msg.content) continue;
      try {
        const parsed: unknown = JSON.parse(msg.content);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'type' in parsed &&
          'content' in parsed &&
          ((parsed as { type: string }).type === 'html' || (parsed as { type: string }).type === 'gui')
        ) {
          found.push({ messageId: msg.id, block: parsed as RAAppBlock, index: idx++ });
        }
      } catch {
        // not JSON — skip
      }
    }
    return found;
  }, [messages]);

  const selected = selectedIdx !== null ? sessionApps[selectedIdx] ?? null : null;

  // ── Load catalog ─────────────────────────────────────────────────────────
  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [groupData, flatData] = await Promise.all([
        getRAAppGroups().catch((): RAAppGroup[] => []),
        getRAApps().catch((): RAAppSummary[] => []),
      ]);
      setGroups(groupData);
      const buckets = bucketCatalogApps(flatData, groupData);
      setCoreApps(buckets.coreApps);
      setUserStandaloneApps(buckets.userStandaloneApps);
    } catch (err) {
      setCatalogError(`Failed to load catalog: ${(err as Error).message}`);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  // ── Upload ───────────────────────────────────────────────────────────────
  const handleUpload = useCallback(
    async (file: File) => {
      if (!file.name.endsWith('.zip')) {
        setCatalogError('Only .zip files are supported.');
        return;
      }
      setUploading(true);
      setCatalogError(null);
      try {
        await uploadRAApp(file);
        await refreshCatalog();
      } catch {
        setCatalogError('Upload failed — check that the ZIP contains a valid meta.yml.');
      } finally {
        setUploading(false);
      }
    },
    [refreshCatalog],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleUpload(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleUpload(file);
  };

  // ── Catalog action handlers ──────────────────────────────────────────────
  const handleRun = useCallback(
    (name: string) => {
      const { setPendingMessage } = useSessionStore.getState();
      setPendingMessage(`Run the "${name}" RA-App for me. Launch it immediately.`);
      onRunWithAgent();
    },
    [onRunWithAgent],
  );

  const handleGroupApprove = useCallback(
    async (slug: string, bumpType: 'patch' | 'minor' | 'major') => {
      await approveRAAppDraft(slug, bumpType);
      await refreshCatalog();
    },
    [refreshCatalog],
  );

  const handleGroupDiscard = useCallback(
    async (slug: string) => {
      await discardRAAppDraft(slug);
      await refreshCatalog();
    },
    [refreshCatalog],
  );

  const handleGroupRollback = useCallback(
    async (slug: string, version: string) => {
      await rollbackRAApp(slug, version);
      await refreshCatalog();
    },
    [refreshCatalog],
  );

  const handleGroupDelete = useCallback(
    async (slug: string) => {
      await deleteRAAppGroup(slug);
      await refreshCatalog();
    },
    [refreshCatalog],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Catalog section ─────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b border-base-300 shrink-0 flex items-center justify-between">
        <span className="text-xs font-semibold text-base-content/60 uppercase tracking-wider flex items-center gap-1.5">
          <Package size={12} />
          Catalog ({groups.length + coreApps.length + userStandaloneApps.length})
        </span>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-xs btn-ghost"
            onClick={() => void refreshCatalog()}
            disabled={catalogLoading}
            title="Refresh catalog"
          >
            <RefreshCw size={12} className={catalogLoading ? 'animate-spin' : ''} />
          </button>
          <button
            className="btn btn-xs btn-ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Upload RA-App ZIP"
          >
            <Upload size={12} />
          </button>
          <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleFileInput} />
        </div>
      </div>

      {/* Drop zone */}
      <div
        className={`mx-2 mt-2 shrink-0 border-2 border-dashed rounded-lg transition-colors text-center text-xs py-2 cursor-pointer ${
          dragOver ? 'border-primary bg-primary/10 text-primary' : 'border-base-300 text-base-content/30 hover:border-base-content/20'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? 'Uploading…' : 'Drop a .zip or click to upload'}
      </div>

      {catalogError && (
        <p className="text-[10px] text-error px-3 py-1 shrink-0">{catalogError}</p>
      )}

      <div className="overflow-y-auto shrink-0 max-h-72 p-2 flex flex-col gap-2">
        {catalogLoading && groups.length === 0 && coreApps.length === 0 && userStandaloneApps.length === 0 && (
          <p className="text-xs text-base-content/30 text-center py-2">Loading catalog…</p>
        )}

        {groups.map((group) => (
          <RAAppGroupCard
            key={group.slug}
            group={group}
            onRun={(slug) => {
              const g = groups.find((x) => x.slug === slug);
              if (g) handleRun(g.current.meta.name);
            }}
            onDelete={(slug) => void handleGroupDelete(slug)}
            onApprove={handleGroupApprove}
            onDiscardDraft={handleGroupDiscard}
            onRollback={handleGroupRollback}
          />
        ))}

        {coreApps.map((app) => (
          <RAAppCoreCard key={app.id} app={app} onRun={() => handleRun(app.name)} />
        ))}

        {userStandaloneApps.map((app) => (
          <RAAppCoreCard key={app.id} app={app} onRun={() => handleRun(app.name)} />
        ))}

        {!catalogLoading && groups.length === 0 && coreApps.length === 0 && userStandaloneApps.length === 0 && (
          <p className="text-xs text-base-content/30 text-center py-2">
            No apps in catalog — upload a .zip to get started
          </p>
        )}
      </div>

      {/* ── Session section ──────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-t border-b border-base-300 shrink-0">
        <span className="text-xs font-semibold text-base-content/60 uppercase tracking-wider">
          Session ({sessionApps.length})
        </span>
      </div>

      {sessionApps.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-4">
          <RefreshCw size={24} className="text-base-content/20" />
          <p className="text-sm text-base-content/40">No RA-Apps in current session</p>
          <p className="text-xs text-base-content/30">Ask the assistant to create an HTML or GUI app</p>
        </div>
      )}

      {sessionApps.length > 0 && (
        <>
          <div className="flex flex-col gap-1 p-2 overflow-y-auto shrink-0 max-h-40 border-b border-base-300">
            {sessionApps.map((app, i) => (
              <button
                key={app.messageId + i}
                onClick={() => setSelectedIdx(i)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
                  selectedIdx === i ? 'bg-sky-500/15 text-sky-400' : 'hover:bg-base-200 text-base-content/70'
                }`}
              >
                {app.block.type === 'html' ? (
                  <Globe size={14} className="shrink-0" />
                ) : (
                  <Code2 size={14} className="shrink-0" />
                )}
                <span className="flex-1 truncate">
                  {app.block.type.toUpperCase()} App #{i + 1}
                </span>
                <span className="text-xs text-base-content/40 shrink-0 flex items-center gap-1">
                  <Eye size={10} />
                  {app.block.mode}
                </span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-2">
            {selected ? (
              <RAAppRenderer block={selected.block} />
            ) : (
              <p className="text-xs text-base-content/40 text-center pt-4">Select an app to preview</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

