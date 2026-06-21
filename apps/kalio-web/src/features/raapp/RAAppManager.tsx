import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Eye, FolderOpen, Package, RefreshCw, Upload } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { bucketCatalogApps } from './catalog.utils';
import {
  CatalogView,
  PreviewPane,
  SessionView,
  WorkView,
  type CatalogRunTarget,
  type FoundRAApp,
  type WorkDraft,
} from './RAAppManager.Views';
import {
  getRAApps,
  getRAAppGroups,
  getSessionVfsFiles,
  getRAAppGroupDownloadUrl,
  uploadRAApp,
  approveRAAppDraft,
  discardRAAppDraft,
  rollbackRAApp,
  deleteRAAppGroup,
} from '../../services/apiClient';
import type { RAAppBlock, RAAppSummary, RAAppGroup, VFSFile } from '@kalio/types';
import { createAndActivateEmptyHostSession } from '../chat/activeConversationSession';
import { buildRAAppLaunchRuntimeContext } from './raappLaunchRuntimeContext';

type RAAppSource = 'catalog' | 'work' | 'session';

interface RAAppManagerProps {
  onOpenVFS: (appId: string) => void;
  onRunWithAgent: () => void;
}

function safeParseRAAppMessage(content: string): RAAppBlock | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (err) {
    void err;
    return null;
  }

  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'type' in parsed &&
    'content' in parsed &&
    ((parsed as { type: string }).type === 'html' || (parsed as { type: string }).type === 'gui')
  ) {
    return parsed as RAAppBlock;
  }

  return null;
}

export function RAAppManager({ onOpenVFS, onRunWithAgent }: RAAppManagerProps) {
  const [groups, setGroups] = useState<RAAppGroup[]>([]);
  const [coreApps, setCoreApps] = useState<RAAppSummary[]>([]);
  const [userStandaloneApps, setUserStandaloneApps] = useState<RAAppSummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [activeSource, setActiveSource] = useState<RAAppSource>('work');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const messages = useSessionStore((s) => s.messages);
  const addSession = useSessionStore((s) => s.addSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setMessages = useSessionStore((s) => s.setMessages);
  const setAgentTurns = useSessionStore((s) => s.setAgentTurns);
  const setPendingMessage = useSessionStore((s) => s.setPendingMessage);
  const setPendingRAAppLaunchIntent = useSessionStore((s) => s.setPendingRAAppLaunchIntent);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [workFiles, setWorkFiles] = useState<VFSFile[]>([]);
  const [workLoading, setWorkLoading] = useState(false);
  const [workError, setWorkError] = useState<string | null>(null);

  const sessionApps = useMemo<FoundRAApp[]>(() => {
    const found: FoundRAApp[] = [];
    let idx = 0;
    for (const msg of messages) {
      if (msg.role !== 'tool_result' || !msg.content) continue;
      const block = safeParseRAAppMessage(msg.content);
      if (block) {
        found.push({ messageId: msg.id, block, index: idx++ });
      }
    }
    return found;
  }, [messages]);

  const selected = selectedIdx !== null ? sessionApps[selectedIdx] ?? null : null;

  const workDrafts = useMemo<WorkDraft[]>(() => {
    const drafts = new Map<string, VFSFile[]>();
    for (const file of workFiles) {
      const parts = file.path.split('/');
      if (parts[0] !== 'drafts' || !parts[1]) continue;
      drafts.set(parts[1], [...(drafts.get(parts[1]) ?? []), file]);
    }

    return Array.from(drafts.entries())
      .map(([id, files]) => ({
        id,
        files: files.slice().sort((a, b) => a.path.localeCompare(b.path)),
        updatedAt: Math.max(...files.map((file) => file.updatedAt)),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [workFiles]);

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

  const refreshWork = useCallback(async () => {
    if (!activeSessionId) {
      setWorkFiles([]);
      setWorkError(null);
      return;
    }

    setWorkLoading(true);
    setWorkError(null);
    try {
      const result = await getSessionVfsFiles(activeSessionId);
      setWorkFiles(result.files);
    } catch (err) {
      setWorkFiles([]);
      setWorkError(`Failed to load work files: ${(err as Error).message}`);
    } finally {
      setWorkLoading(false);
    }
  }, [activeSessionId]);

  useEffect(() => {
    void refreshWork();
  }, [refreshWork]);

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
      } catch (err) {
        setCatalogError(`Upload failed - check that the ZIP contains a valid meta.yml. ${err instanceof Error ? err.message : ''}`.trim());
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

  const handleRun = useCallback(
    async (target: CatalogRunTarget) => {
      try {
        const session = await createAndActivateEmptyHostSession({
          personaId: 'ra-apps',
          title: target.name,
          runtimeContext: buildRAAppLaunchRuntimeContext(target.id, target.name, 'raapp_manager'),
          addSession,
          setActiveSession,
          setMessages,
          setAgentTurns,
          reason: 'app-open',
        });
        const prompt = `Run the "${target.name}" RA-App for me.${target.description ? ` ${target.description}` : ''} Launch it immediately.`;
        setPendingRAAppLaunchIntent({
          targetSessionId: session.id,
          appId: target.id,
          appName: target.name,
          personaId: 'ra-apps',
          prompt,
          source: 'raapp_manager',
        });
        onRunWithAgent();
      } catch (err) {
        console.error('[RAAppManager] failed to create session for RA-App run', err);
      }
    },
    [addSession, onRunWithAgent, setActiveSession, setAgentTurns, setMessages, setPendingRAAppLaunchIntent],
  );

  const handleWorkAction = useCallback((message: string) => {
    setPendingMessage(message);
    onRunWithAgent();
  }, [onRunWithAgent, setPendingMessage]);

  const catalogCount = groups.length + coreApps.length + userStandaloneApps.length;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-base-100" data-testid="raapp-manager">
      <header className="shrink-0 border-b border-base-300 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Package size={18} className="text-sky-400" />
              <h1 className="text-lg font-semibold text-base-content">RAApps</h1>
              <span className="badge badge-sm badge-ghost">{catalogCount} catalog</span>
              <span className="badge badge-sm badge-ghost">{workDrafts.length} drafts</span>
              <span className="badge badge-sm badge-ghost">{sessionApps.length} session</span>
            </div>
            <p className="mt-1 text-xs text-base-content/45">
              Browse installed apps, manage active drafts, and preview generated session apps.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm btn-ghost gap-2" onClick={() => void refreshCatalog()} disabled={catalogLoading}>
              <RefreshCw size={14} className={catalogLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button className="btn btn-sm btn-primary gap-2" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Upload size={14} />
              {uploading ? 'Uploading...' : 'Upload ZIP'}
            </button>
            <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleFileInput} />
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)_minmax(340px,0.44fr)]">
        <aside className="border-b border-base-300 bg-base-200/30 p-3 xl:border-b-0 xl:border-r">
          <div className="grid grid-cols-3 gap-2 xl:flex xl:flex-col">
            {[
              { id: 'catalog' as const, label: 'Catalog', count: catalogCount, icon: <Package size={15} /> },
              { id: 'work' as const, label: 'Work', count: workDrafts.length, icon: <FolderOpen size={15} /> },
              { id: 'session' as const, label: 'Session', count: sessionApps.length, icon: <Eye size={15} /> },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  activeSource === item.id
                    ? 'border-sky-500 bg-sky-500/12 text-sky-300'
                    : 'border-base-300 bg-base-100/60 text-base-content/65 hover:border-base-content/20 hover:text-base-content'
                }`}
                onClick={() => setActiveSource(item.id)}
              >
                <span className="flex items-center gap-2 text-xs font-semibold">
                  {item.icon}
                  <span>{item.label}</span>
                  <span className="ml-auto badge badge-xs badge-ghost">{item.count}</span>
                </span>
              </button>
            ))}
          </div>

          <div
            className={`mt-3 rounded-lg border border-dashed px-3 py-3 text-center text-xs transition-colors ${
              dragOver ? 'border-primary bg-primary/10 text-primary' : 'border-base-300 text-base-content/40 hover:border-base-content/25'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? 'Uploading...' : 'Drop a .zip here'}
          </div>
          {catalogError && <p className="mt-2 text-xs text-error">{catalogError}</p>}
        </aside>

        <section className="min-h-0 overflow-y-auto border-b border-base-300 p-4 xl:border-b-0 xl:border-r">
          {activeSource === 'catalog' && (
            <CatalogView
              catalogCount={catalogCount}
              catalogLoading={catalogLoading}
              groups={groups}
              coreApps={coreApps}
              userStandaloneApps={userStandaloneApps}
              onRun={handleRun}
              onGroupDelete={(slug) => {
                void deleteRAAppGroup(slug).then(refreshCatalog);
              }}
              onGroupApprove={(slug, bumpType) => approveRAAppDraft(slug, bumpType).then(refreshCatalog)}
              onGroupDiscard={(slug) => discardRAAppDraft(slug).then(refreshCatalog)}
              onGroupRollback={(slug, version) => rollbackRAApp(slug, version).then(refreshCatalog)}
              onGroupDownload={(slug, version) => window.open(getRAAppGroupDownloadUrl(slug, version), '_blank')}
            />
          )}

          {activeSource === 'work' && (
            <WorkView
              activeSessionId={activeSessionId}
              workDrafts={workDrafts}
              workLoading={workLoading}
              workError={workError}
              onOpenVFS={onOpenVFS}
              onWorkAction={handleWorkAction}
            />
          )}

          {activeSource === 'session' && (
            <SessionView
              sessionApps={sessionApps}
              selectedIdx={selectedIdx}
              onSelect={(index) => setSelectedIdx(index)}
            />
          )}
        </section>

        <PreviewPane selected={selected} />
      </div>
    </div>
  );
}
