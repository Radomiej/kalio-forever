import {
  Code2,
  Eye,
  FileCode,
  FlaskConical,
  FolderOpen,
  Globe,
  Play,
  RefreshCw,
  Rocket,
  Workflow,
} from 'lucide-react';
import { RAAppRenderer } from './RAAppRenderer';
import { RAAppGroupCard } from './components/RAAppGroupCard';
import { RAAppCoreCard } from './components/RAAppCoreCard';
import type { RAAppBlock, RAAppGroup, RAAppSummary, VFSFile } from '@kalio/types';

export interface CatalogRunTarget {
  id: string;
  name: string;
  description?: string;
}

export interface FoundRAApp {
  messageId: string;
  block: RAAppBlock;
  index: number;
}

export interface WorkDraft {
  id: string;
  files: VFSFile[];
  updatedAt: number;
}

export function CatalogView({
  catalogCount,
  catalogLoading,
  groups,
  coreApps,
  userStandaloneApps,
  onRun,
  onGroupDelete,
  onGroupApprove,
  onGroupDiscard,
  onGroupRollback,
  onGroupDownload,
}: {
  catalogCount: number;
  catalogLoading: boolean;
  groups: RAAppGroup[];
  coreApps: RAAppSummary[];
  userStandaloneApps: RAAppSummary[];
  onRun: (target: CatalogRunTarget) => void;
  onGroupDelete: (slug: string) => void;
  onGroupApprove: (slug: string, bumpType: 'patch' | 'minor' | 'major') => Promise<void>;
  onGroupDiscard: (slug: string) => Promise<void>;
  onGroupRollback: (slug: string, version: string) => Promise<void>;
  onGroupDownload: (slug: string, version: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-base-content">Catalog ({catalogCount})</h2>
        <p className="text-xs text-base-content/45">Installed user and core RAApps ready to run.</p>
      </div>
      {catalogLoading && catalogCount === 0 && (
        <p className="rounded-lg border border-base-300 bg-base-200/40 p-6 text-center text-sm text-base-content/45">
          Loading catalog...
        </p>
      )}
      {!catalogLoading && catalogCount === 0 && (
        <div className="rounded-lg border border-base-300 bg-base-200/40 p-8 text-center">
          <p className="text-sm font-medium text-base-content/70">No apps in catalog</p>
          <p className="mt-1 text-xs text-base-content/40">Upload a ZIP to add the first RAApp.</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {groups.map((group, index) => (
          <RAAppGroupCard
            key={`group:${group.slug}:${index}`}
            group={group}
            onRun={(slug) => {
              const g = groups.find((item) => item.slug === slug);
              if (g) {
                onRun({
                  id: g.current.meta.id,
                  name: g.current.meta.name,
                });
              }
            }}
            onDelete={onGroupDelete}
            onApprove={onGroupApprove}
            onDiscardDraft={onGroupDiscard}
            onRollback={onGroupRollback}
            onDownloadVersion={onGroupDownload}
          />
        ))}
        {coreApps.map((app, index) => <RAAppCoreCard key={`core:${app.id}:${index}`} app={app} onRun={onRun} />)}
        {userStandaloneApps.map((app, index) => <RAAppCoreCard key={`user:${app.id}:${index}`} app={app} onRun={onRun} />)}
      </div>
    </div>
  );
}

export function WorkView({
  activeSessionId,
  workDrafts,
  workLoading,
  workError,
  onOpenVFS,
  onWorkAction,
}: {
  activeSessionId: string | null;
  workDrafts: WorkDraft[];
  workLoading: boolean;
  workError: string | null;
  onOpenVFS: (appId: string) => void;
  onWorkAction: (message: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-base-content">Work ({workDrafts.length})</h2>
          <p className="text-xs text-base-content/45">Drafts from the active session VFS.</p>
        </div>
        {activeSessionId && (
          <button className="btn btn-sm btn-ghost gap-2" onClick={() => onOpenVFS(activeSessionId)} data-testid={`raapp-work-open-vfs-${activeSessionId}`}>
            <FolderOpen size={14} />
            Open VFS
          </button>
        )}
      </div>
      {workLoading && <p className="rounded-lg border border-base-300 p-6 text-center text-sm text-base-content/45">Loading work files...</p>}
      {!workLoading && workError && <p className="rounded-lg border border-error/40 bg-error/10 p-4 text-sm text-error">{workError}</p>}
      {!workLoading && !workError && workDrafts.length === 0 && (
        <div className="rounded-lg border border-base-300 bg-base-200/40 p-8 text-center">
          <p className="text-sm font-medium text-base-content/70">No raw drafts in the active session</p>
          <p className="mt-1 text-xs text-base-content/40">Ask the assistant to create or update an RAApp draft.</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {workDrafts.map((draft) => <WorkDraftCard key={draft.id} draft={draft} onWorkAction={onWorkAction} />)}
      </div>
    </div>
  );
}

function WorkDraftCard({ draft, onWorkAction }: { draft: WorkDraft; onWorkAction: (message: string) => void }) {
  const hasGui = draft.files.some((file) => file.path.endsWith('/ui.gui'));
  const hasSystems = draft.files.some((file) => file.path.endsWith('/systems.yml'));
  const hasTests = draft.files.some((file) => file.path.endsWith('/tests.yml'));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-base-300 bg-base-200/70 p-4" data-testid={`raapp-work-draft-${draft.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-base-content">{draft.id}</p>
          <p className="text-xs text-base-content/45">{draft.files.length} files</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {hasGui && <span className="badge badge-sm badge-info gap-1"><FileCode size={10} />ui</span>}
          {hasSystems && <span className="badge badge-sm badge-warning gap-1"><Workflow size={10} />systems</span>}
          {hasTests && <span className="badge badge-sm badge-success gap-1"><FlaskConical size={10} />tests</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {draft.files.map((file) => <span key={file.path} className="badge badge-xs badge-ghost">{file.path.split('/').slice(2).join('/') || file.path}</span>)}
      </div>
      <div className="mt-auto flex items-center gap-2 border-t border-base-300 pt-3">
        <button className="btn btn-sm btn-ghost gap-2" onClick={() => onWorkAction(`Run raapp_test for draft_id "${draft.id}" now and summarize the results briefly.`)} data-testid={`raapp-work-test-${draft.id}`}>
          <FlaskConical size={13} />
          Test
        </button>
        <button className="btn btn-sm btn-primary gap-2" onClick={() => onWorkAction(`Run the RA-App draft "${draft.id}" now using raapp_execute_dsl and launch it immediately.`)} data-testid={`raapp-work-run-${draft.id}`}>
          <Play size={13} />
          Run
        </button>
        <button className="btn btn-sm btn-success ml-auto gap-2" onClick={() => onWorkAction(`Publish the RA-App draft "${draft.id}" now using raapp_publish_draft with bump_type "minor", then report the released version.`)} data-testid={`raapp-work-publish-${draft.id}`}>
          <Rocket size={13} />
          Publish
        </button>
      </div>
    </div>
  );
}

export function SessionView({
  sessionApps,
  selectedIdx,
  onSelect,
}: {
  sessionApps: FoundRAApp[];
  selectedIdx: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-base-content">Session ({sessionApps.length})</h2>
        <p className="text-xs text-base-content/45">Apps generated in the current conversation.</p>
      </div>
      {sessionApps.length === 0 && (
        <div className="rounded-lg border border-base-300 bg-base-200/40 p-8 text-center">
          <RefreshCw size={24} className="mx-auto text-base-content/20" />
          <p className="mt-3 text-sm font-medium text-base-content/65">No RAApps in current session</p>
          <p className="mt-1 text-xs text-base-content/40">Ask the assistant to create an HTML or GUI app.</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2">
        {sessionApps.map((app, i) => (
          <button
            key={`session:${app.messageId}:${i}`}
            onClick={() => onSelect(i)}
            className={`rounded-lg border px-3 py-3 text-left transition-colors ${
              selectedIdx === i ? 'border-sky-500 bg-sky-500/12 text-sky-300' : 'border-base-300 bg-base-200/60 text-base-content/70 hover:border-base-content/20'
            }`}
          >
            <span className="flex items-center gap-2">
              {app.block.type === 'html' ? <Globe size={15} /> : <Code2 size={15} />}
              <span className="flex-1 text-sm font-medium">{app.block.type.toUpperCase()} App #{i + 1}</span>
              <span className="badge badge-xs badge-ghost">{app.block.mode}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PreviewPane({ selected }: { selected: FoundRAApp | null }) {
  return (
    <aside className="min-h-[280px] overflow-y-auto bg-base-200/20 p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-base-content">Preview & details</h2>
        <p className="text-xs text-base-content/45">Session app previews appear here when selected.</p>
      </div>
      {selected ? (
        <div className="rounded-lg border border-base-300 bg-base-100 p-3">
          <RAAppRenderer block={selected.block} />
        </div>
      ) : (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-base-300 bg-base-100/60 p-6 text-center">
          <Eye size={26} className="text-base-content/20" />
          <p className="mt-3 text-sm font-medium text-base-content/60">No preview selected</p>
          <p className="mt-1 max-w-xs text-xs text-base-content/40">
            Select a generated session app to inspect it here. Catalog and draft actions stay in the main workbench.
          </p>
        </div>
      )}
    </aside>
  );
}
