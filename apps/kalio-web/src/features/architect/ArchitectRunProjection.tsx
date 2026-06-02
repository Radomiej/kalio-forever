import { useState } from 'react';
import { ArrowRight, CheckCircle2, Circle, Loader2, RotateCcw } from 'lucide-react';
import type { ArchitectureRouteDecision } from '@kalio/types';
import type { ArchitectProjectionTab, ArchitectRunResult, ArchitectSchema, ExternalQualityGateInput } from './architect.types';

interface ArchitectRunProjectionProps {
  activeTab: ArchitectProjectionTab;
  onTabChange: (tab: ArchitectProjectionTab) => void;
  run: ArchitectRunResult | null;
  schema: ArchitectSchema | null;
  collapsed?: boolean;
  running?: boolean;
  onResumeWithQualityGate?: (gate: ExternalQualityGateInput) => void;
}

const PROJECTION_TABS: ReadonlyArray<{ id: ArchitectProjectionTab; label: string }> = [
  { id: 'editor', label: 'Editor' },
  { id: 'events', label: 'Timeline' },
  { id: 'graph', label: 'Execution Graph' },
  { id: 'chat', label: 'Chat' },
];

export function ArchitectRunProjection({
  activeTab,
  onTabChange,
  run,
  schema,
  collapsed = false,
  running = false,
  onResumeWithQualityGate,
}: ArchitectRunProjectionProps) {
  const expandedHeight = activeTab === 'graph' || activeTab === 'chat' ? 'h-72' : 'h-44';
  const displayStatus = run?.agentFlowStatus ?? run?.run.status;
  const isActivelyRunning = running && (displayStatus === undefined || displayStatus === 'running' || displayStatus === 'queued');
  const isWaitingAgentFlow = run?.agentFlowStatus === 'waiting_on_orchestrator';

  return (
    <section className={`flex shrink-0 flex-col bg-transparent ${collapsed ? 'h-10' : expandedHeight}`}>
      <div className={`flex items-center justify-between px-3 py-2 ${collapsed ? '' : 'border-b border-base-300/80'}`}>
        <div className="join">
          {PROJECTION_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`btn join-item btn-xs ${activeTab === tab.id ? 'btn-info' : 'btn-ghost'}`}
              onClick={() => onTabChange(tab.id)}
              data-testid={`architect-projection-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {(run || running) && (
          <div className="flex items-center gap-2 text-xs text-base-content/55">
            {isActivelyRunning && <Loader2 size={13} className="animate-spin text-sky-300" />}
            {run ? <span className="font-mono">{run.run.id}</span> : <span>Run in progress</span>}
            {run && <span className="badge badge-ghost badge-sm">{run.run.executionMode}</span>}
            <span className="badge badge-ghost badge-sm">{isActivelyRunning ? 'running' : displayStatus}</span>
            {isWaitingAgentFlow && (
              <ResumeQualityGateForm onSubmit={onResumeWithQualityGate} disabled={!onResumeWithQualityGate || running} />
            )}
          </div>
        )}
      </div>

      {collapsed && (
        <span className="hidden">
          {schema?.name ?? 'No schema'} {schema?.nodes.length ?? 0} nodes configured
        </span>
      )}

      {!collapsed && (
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {activeTab === 'editor' && (
          <div className="flex h-full items-center gap-4 text-xs text-base-content/60">
            <span className="font-semibold text-base-content">{schema?.name ?? 'No schema'}</span>
            <span>{schema?.nodes.length ?? 0} nodes</span>
            <span>{schema?.edges.length ?? 0} transitions</span>
            {running && <span className="text-sky-200">Architecture run is executing...</span>}
            <span>{run ? `${run.run.id} ${run.run.status} via ${run.run.executionMode}` : 'No run started yet'}</span>
          </div>
        )}

        {activeTab === 'events' && (
          <div className="space-y-2">
            {run?.agentFlowSummary && (
              <div className="rounded-lg border border-info/30 bg-info/10 p-2 text-xs font-medium text-info-content">
                {run.agentFlowSummary}
              </div>
            )}
            {(run?.events ?? []).map((event, index) => (
              <div key={event.id ?? `${event.createdAt ?? 'event'}-${index}`} className="rounded-lg border border-base-300 p-2">
                <div className="text-xs font-semibold text-base-content">
                  {event.message}
                </div>
                <div className="mt-1 text-[11px] text-base-content/45">
                  #{event.sequence} {event.type} {event.nodeId ?? ''}
                </div>
                {formatEventSessionMeta(event.data) && (
                  <div className="mt-1 font-mono text-[10px] text-base-content/40">
                    {formatEventSessionMeta(event.data)}
                  </div>
                )}
                <RouteHop route={event.route} />
              </div>
            ))}
            {running && !run?.events?.length && (
              <div className="flex items-center gap-2 rounded-lg border border-sky-500/25 bg-sky-500/10 p-2 text-xs text-sky-100">
                <Loader2 size={14} className="animate-spin" />
                <span>Run started. Waiting for branch events and final artifact...</span>
              </div>
            )}
            {!run?.events?.length && <p className="text-xs text-base-content/40">No timeline events yet.</p>}
          </div>
        )}

        {activeTab === 'graph' && (
          <GraphStatus run={run} schema={schema} />
        )}

        {activeTab === 'chat' && (
          <div className="space-y-2">
            {(run?.chat.messages ?? []).map((message, index) => (
              <div
                key={message.id ?? `message-${index}`}
                className="rounded-lg border border-base-300 bg-base-200/60 p-2"
                data-testid="architect-chat-message"
              >
                <div className="text-[10px] font-bold uppercase tracking-wide text-sky-300">
                  {message.speaker}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-base-content/70">{message.content}</p>
                <RouteHop route={message.route} />
              </div>
            ))}
            {!run?.chat.messages.length && <p className="text-xs text-base-content/40">No chat projection yet.</p>}
          </div>
        )}
      </div>
      )}
    </section>
  );
}

function ResumeQualityGateForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit?: (gate: ExternalQualityGateInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState('Playwright Orchestrator found unresolved QA findings.');
  const [highFindings, setHighFindings] = useState(1);
  const [artifactPath, setArtifactPath] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <RotateCcw size={12} />
        Resume with QA evidence
      </button>
    );
  }

  return (
    <div className="absolute right-3 top-10 z-20 w-80 rounded-lg border border-base-300 bg-base-100 p-3 shadow-xl">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-base-content/60">External QA Gate</div>
      <label className="form-control">
        <span className="label-text text-[11px]">Summary</span>
        <textarea
          className="textarea textarea-bordered textarea-xs min-h-16"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          data-testid="agentflow-qa-summary"
        />
      </label>
      <div className="mt-2 grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
        <label className="form-control">
          <span className="label-text text-[11px]">High</span>
          <input
            className="input input-bordered input-xs"
            min={0}
            type="number"
            value={highFindings}
            onChange={(event) => setHighFindings(Math.max(0, Number(event.target.value) || 0))}
            data-testid="agentflow-qa-high-findings"
          />
        </label>
        <label className="form-control">
          <span className="label-text text-[11px]">Artifact path</span>
          <input
            className="input input-bordered input-xs"
            value={artifactPath}
            onChange={(event) => setArtifactPath(event.target.value)}
            data-testid="agentflow-qa-artifact"
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-info btn-xs"
          disabled={summary.trim().length === 0 || !onSubmit}
          onClick={() => {
            onSubmit?.({
              source: 'playwright',
              status: highFindings > 0 ? 'failed' : 'passed',
              highFindings,
              summary,
              artifactPath,
            });
            setOpen(false);
          }}
          data-testid="agentflow-resume-with-qa"
        >
          Resume
        </button>
      </div>
    </div>
  );
}

function GraphStatus({ run, schema }: Pick<ArchitectRunProjectionProps, 'run' | 'schema'>) {
  const nodes = run?.graph.nodes ?? schema?.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    kind: node.kind,
    behavior: node.behavior,
    status: 'pending' as const,
    visitCount: 0,
    eventIds: [],
  })) ?? [];
  const edges = run?.graph.edges ?? schema?.edges ?? [];

  if (nodes.length === 0) {
    return <p className="text-xs text-base-content/40">No graph projection yet.</p>;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]" data-testid="architect-graph-status">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {nodes.map((node) => (
          <div
            key={node.id}
            className={`rounded-lg border p-3 ${
              node.status === 'running'
                ? 'border-sky-400/50 bg-sky-500/10 shadow-[0_0_24px_-14px_rgba(56,189,248,0.9)]'
                : 'border-base-300 bg-base-200/60'
            }`}
            data-testid={`architect-projection-node-${node.id}`}
          >
            <div className="flex items-start gap-2">
              {node.status === 'completed'
                ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                : node.status === 'running'
                  ? <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-sky-300" />
                  : <Circle size={15} className="mt-0.5 shrink-0 text-base-content/35" />}
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-base-content">{node.label}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-base-content/40">
                  <span>{node.status}</span>
                  <span>/</span>
                  <span>{node.kind}</span>
                  {node.behavior?.mode && (
                    <>
                      <span>/</span>
                      <span>{node.behavior.mode.replaceAll('_', ' ')}</span>
                    </>
                  )}
                  <span>/</span>
                  <span>{node.eventIds.length} events</span>
                  <span>/</span>
                  <span>{node.visitCount ?? node.eventIds.length} calls</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-base-300 bg-base-200/60 p-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-base-content/45">Transitions</div>
        <div className="space-y-1.5">
          {edges.map((edge) => (
            <div key={edge.id} className="flex items-center gap-2 text-[11px] text-base-content/60">
              <span className="min-w-0 truncate font-mono">{edge.fromNodeId}</span>
              <ArrowRight size={12} className="shrink-0 text-sky-400" />
              <span className="min-w-0 truncate font-mono">{edge.toNodeId}</span>
            </div>
          ))}
          {edges.length === 0 && <p className="text-xs text-base-content/40">No transitions configured.</p>}
        </div>
        {(run?.graph.routeHops?.length ?? 0) > 0 && (
          <div className="mt-3 border-t border-base-300/70 pt-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-base-content/45">Executed route</div>
            <div className="space-y-1.5" data-testid="architect-executed-route">
              {run?.graph.routeHops?.map((hop, index) => (
                <RouteLine key={`${hop.eventId}:${hop.toNodeId}:${index}`} source={hop.source} fromNodeId={hop.fromNodeId} toNodeId={hop.toNodeId} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RouteHop({ route }: { route?: ArchitectureRouteDecision }) {
  if (!route) return null;
  return (
    <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-100">
      <span className="shrink-0 font-semibold uppercase tracking-wide">{route.source}</span>
      <span className="min-w-0 truncate font-mono">{formatRoute(route)}</span>
    </div>
  );
}

function RouteLine({ source, fromNodeId, toNodeId }: { source: ArchitectureRouteDecision['source']; fromNodeId: string; toNodeId: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[11px] text-base-content/65">
      <span className="badge badge-ghost badge-xs shrink-0">{source}</span>
      <span className="min-w-0 truncate font-mono">{fromNodeId} -&gt; {toNodeId}</span>
    </div>
  );
}

function formatRoute(route: ArchitectureRouteDecision): string {
  const target = route.selectedNodeIds.length > 1
    ? route.selectedNodeIds.join(', ')
    : route.nextNodeId ?? route.selectedNodeIds[0] ?? 'end';
  return `${route.fromNodeId} -> ${target}`;
}

function formatEventSessionMeta(data: Record<string, unknown> | undefined): string | null {
  const branchSessionId = data?.['branchSessionId'];
  if (typeof branchSessionId === 'string' && branchSessionId.length > 0) {
    return `branch ${branchSessionId}`;
  }

  const rootSessionId = data?.['rootSessionId'];
  if (typeof rootSessionId === 'string' && rootSessionId.length > 0) {
    return `root ${rootSessionId}`;
  }

  return null;
}
