import { ChevronLeft, ChevronRight, Eye, FileCode2, FileImage } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ToolConfirmationRequest } from '@kalio/types';
import { ExecutionGraphPreviewPanel, extractGraphNodePreview } from './ExecutionGraphPreview';
import { GraphInspectorActions } from './GraphInspectorActions';
import type { ExecutionGraphNode, ExecutionGraphNodePayload } from './executionGraphModel';

function prettyPrint(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function shortNodeLabel(value: string | null | undefined): string {
  const source = typeof value === 'string' ? value : 'unknown';
  return source
    .replace(/^architecture-root:/, '')
    .replace(/^node:/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function statusLabel(status: 'idle' | 'running' | 'success' | 'error'): string {
  if (status === 'error') return 'error';
  if (status === 'running') return 'running';
  if (status === 'success') return 'ready';
  return 'idle';
}

function payloadTitle(payload: ExecutionGraphNodePayload): string {
  switch (payload.kind) {
    case 'prompt':
      return 'Prompt details';
    case 'turn':
      return 'Turn details';
    case 'tool':
      return 'Tool details';
    case 'tool-group':
      return 'Grouped tools';
    case 'subagent':
      return 'Sub-agent details';
    case 'cli-agent':
      return 'CLI child details';
    case 'agent-flow':
      return 'AgentFlow run';
    case 'architecture-run':
      return 'Architecture run';
    case 'tool-result':
      return 'Tool result fallback';
    case 'artifact':
      return 'Artifact details';
    case 'final-answer':
      return 'Final response';
  }
}

function InspectorRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[64px,1fr] gap-2 text-[12px] leading-5">
      <span className="text-base-content/45">{label}</span>
      <span className="line-clamp-4 break-words text-base-content/85" title={value}>{value}</span>
    </div>
  );
}

function InspectorTextRow({ label, value }: { label: string; value: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!value) return null;

  const expandable = value.length > 180;
  return (
    <div className="space-y-1.5 text-[12px] leading-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-base-content/45">{label}</span>
        {expandable && (
          <button
            type="button"
            className="rounded border border-base-300 bg-base-100/70 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-base-content/55 hover:text-base-content"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? `Collapse ${label}` : `Expand ${label}`}
          </button>
        )}
      </div>
      <p
        className={`break-words rounded-lg border border-base-300/70 bg-base-100/55 px-2.5 py-2 text-base-content/85 ${expanded ? '' : 'line-clamp-4'}`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded border border-base-300 bg-base-100/70 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-base-content/60">
      {label}: <span className="text-base-content/85">{value}</span>
    </span>
  );
}

function toolEvidenceLabel(evidence: NonNullable<NonNullable<Extract<ExecutionGraphNodePayload, { kind: 'architecture-run' }>['route']>['toolEvidence']>): string {
  const names = evidence.successfulToolNames;
  const successful = names.length > 0 ? names.slice(0, 3).join(', ') : 'none';
  const overflow = names.length > 3 ? ` +${names.length - 3}` : '';
  return `${evidence.toolResultCount} result(s), success: ${successful}${overflow}`;
}

interface ExecutionGraphInspectorProps {
  activeSessionId: string;
  inspectorWidth: number;
  selectedConfirmation: ToolConfirmationRequest | null;
  selectedNode: ExecutionGraphNode | null;
  onOpenSessionInConversation?: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  removePendingConfirmation: (sessionId: string, requestId: string) => void;
  setPendingMessage: (message: string | null) => void;
}

export function ExecutionGraphInspector({
  activeSessionId,
  inspectorWidth,
  selectedConfirmation,
  selectedNode,
  onOpenSessionInConversation,
  setActiveSession,
  removePendingConfirmation,
  setPendingMessage,
}: ExecutionGraphInspectorProps) {
  const [showRawData, setShowRawData] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [showSystemDetails, setShowSystemDetails] = useState(false);
  const [collapsed, setCollapsed] = useState(!selectedNode || selectedNode.payload.kind === 'prompt');
  const [userCollapsed, setUserCollapsed] = useState(false);

  useEffect(() => {
    setShowLivePreview(false);
    setShowRawData(false);
    if (!selectedNode) {
      setCollapsed(true);
      return;
    }
    if (!userCollapsed && selectedNode.payload.kind !== 'prompt') {
      setCollapsed(false);
    }
  }, [selectedNode?.id, selectedNode?.payload.kind, userCollapsed]);

  const livePreview = selectedNode ? extractGraphNodePreview(selectedNode) : null;

  if (collapsed) {
    return (
      <aside
        data-testid="execution-graph-inspector"
        className="flex h-12 w-full shrink-0 items-center justify-between border-t border-base-300 bg-base-100 px-3 xl:h-auto xl:w-11 xl:flex-col xl:justify-start xl:border-l xl:border-t-0 xl:px-0 xl:py-3"
      >
        <button
          type="button"
          data-testid="graph-inspector-expand"
          className="inline-flex min-h-8 items-center gap-2 rounded-md border border-base-300 px-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/65 transition-colors hover:text-base-content xl:h-8 xl:w-8 xl:justify-center xl:px-0"
          onClick={() => {
            if (selectedNode) {
              setUserCollapsed(false);
              setCollapsed(false);
            }
          }}
          disabled={!selectedNode}
          title="Open node properties"
        >
          <ChevronLeft size={14} className="hidden xl:block" />
          <ChevronRight size={14} className="xl:hidden" />
          <span className="xl:hidden">Node properties</span>
        </button>
        <span className="truncate text-xs text-base-content/45 xl:hidden">
          {selectedNode ? selectedNode.title : 'Select a node'}
        </span>
      </aside>
    );
  }

  return (
    <aside
      data-testid="execution-graph-inspector"
      className="h-60 w-full shrink-0 overflow-y-auto border-t border-base-300 bg-base-100 xl:h-auto xl:w-[var(--graph-inspector-width)] xl:border-l xl:border-t-0"
      style={{ '--graph-inspector-width': `${inspectorWidth}px` } as CSSProperties}
    >
      {selectedNode && (
        <div className="space-y-2 p-2.5">
          <div className="rounded-lg border border-base-300 bg-base-200/35 px-2.5 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold tracking-tight">Node Properties</h3>
                <p className="mt-0.5 truncate text-xs text-base-content/60" title={selectedNode.title}>{selectedNode.title}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <MetaChip label="state" value={statusLabel(selectedNode.status)} />
                <button
                  type="button"
                  data-testid="graph-inspector-collapse"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-base-300 bg-base-100/70 text-base-content/55 transition-colors hover:text-base-content"
                  onClick={() => {
                    setUserCollapsed(true);
                    setCollapsed(true);
                  }}
                  title="Collapse node properties"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <MetaChip label="type" value={selectedNode.kind} />
              {livePreview && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-base-300 bg-base-100/70 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-base-content/55 hover:text-base-content"
                  onClick={() => setShowLivePreview((value) => !value)}
                  aria-expanded={showLivePreview}
                  data-testid="graph-live-preview-toggle"
                >
                  <Eye size={10} />
                  {showLivePreview ? 'Hide preview' : 'Preview'}
                </button>
              )}
              <button
                type="button"
                className="rounded border border-base-300 bg-base-100/70 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-base-content/55 hover:text-base-content"
                onClick={() => setShowSystemDetails((value) => !value)}
              >
                {showSystemDetails ? 'Hide details' : 'Details'}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-base-300 bg-base-100/70 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-base-content/55 hover:text-base-content"
                onClick={() => setShowRawData((value) => !value)}
                aria-expanded={showRawData}
              >
                {selectedNode.payload.kind === 'artifact' ? <FileImage size={10} /> : <FileCode2 size={10} />}
                {showRawData ? 'Hide raw' : 'Show raw'}
              </button>
            </div>
          </div>

          {showLivePreview && (
            <ExecutionGraphPreviewPanel node={selectedNode} fallbackSessionId={activeSessionId} />
          )}

          <section className="space-y-2 rounded-lg border border-base-300 bg-base-200/35 px-2.5 py-2.5">
            <h4 className="text-xs font-semibold tracking-tight">{payloadTitle(selectedNode.payload)}</h4>
            {showSystemDetails && (
              <div className="space-y-1.5 rounded-lg border border-base-300/70 bg-base-100/60 px-2.5 py-2">
                <InspectorRow label="Session" value={shortId(selectedNode.sessionId ?? activeSessionId)} />
                <InspectorRow label="Node" value={shortId(selectedNode.id)} />
                {'callId' in selectedNode && selectedNode.callId ? <InspectorRow label="Call ID" value={shortId(selectedNode.callId)} /> : null}
              </div>
            )}

            {selectedNode.payload.kind === 'turn' && (
              <>
                <InspectorRow label="Persona" value={selectedNode.payload.actorLabel} />
                <InspectorRow label="Model" value={selectedNode.payload.modelLabel} />
                <InspectorRow label="Tools" value={String(selectedNode.payload.toolCount)} />
                <InspectorRow label="Thinking" value={String(selectedNode.payload.thinkingCount)} />
                <InspectorTextRow label="Preview" value={selectedNode.payload.textPreview} />
                {selectedNode.payload.thinkingPreviews.length > 0 && (
                  <div>
                    <p className="mb-1 text-[12px] text-base-content/45">Thinking preview</p>
                    <div className="space-y-1.5">
                      {selectedNode.payload.thinkingPreviews.map((thinking, index) => (
                        <div key={`${selectedNode.id}:thinking:${index}`} className="rounded-lg border border-base-300/70 bg-base-100/65 px-2.5 py-2 text-[12px] leading-5 text-base-content/80">
                          {thinking}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {selectedNode.payload.kind === 'tool' && (
              <>
                <InspectorRow label="Confirm" value={selectedNode.payload.confirmationRequired ? 'accept required' : 'not required'} />
              </>
            )}

            {selectedNode.payload.kind === 'tool-group' && (
              <div className="space-y-2 text-sm text-base-content/80">
                {selectedNode.payload.tools.map((tool) => (
                  <div key={tool.callId} className="rounded-xl border border-base-300/70 bg-base-100/65 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{tool.toolName}</span>
                      <span className="text-xs uppercase tracking-[0.18em] text-base-content/45">{statusLabel(tool.status)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(selectedNode.payload.kind === 'subagent' || selectedNode.payload.kind === 'cli-agent') && (
              <>
                {selectedNode.payload.kind === 'subagent' ? (
                  <>
                    <InspectorRow label="Persona" value={selectedNode.payload.actorLabel} />
                    <InspectorRow label="Model" value={selectedNode.payload.modelLabel} />
                    <InspectorTextRow label="Context" value={selectedNode.payload.inputPrompt} />
                    <InspectorRow label="Mode" value={selectedNode.payload.result?.vfsMode ?? 'live runtime'} />
                    <InspectorRow label="Artifacts" value={`${selectedNode.payload.copiedFiles.length} file(s)`} />
                  </>
                ) : (
                  <>
                    <InspectorRow label="Agent" value={selectedNode.payload.snapshot.agentId} />
                    <InspectorRow label="Workdir" value={selectedNode.payload.snapshot.workdir} />
                    <InspectorTextRow label="Prompt" value={selectedNode.payload.inputPrompt} />
                    <InspectorRow label="Exit" value={selectedNode.payload.snapshot.lastExitCode !== undefined ? String(selectedNode.payload.snapshot.lastExitCode) : undefined} />
                    <InspectorTextRow label="Output" value={selectedNode.payload.snapshot.lastOutput} />
                  </>
                )}
                {selectedNode.payload.transcript.length > 0 && (
                  <div>
                    <p className="text-sm text-base-content/45 mb-2">Transcript tail</p>
                    <div className="space-y-2">
                      {selectedNode.payload.transcript.slice(-3).map((message) => (
                        <div key={message.id} className="rounded-lg border border-base-300/70 bg-base-100/65 px-2.5 py-2">
                          <InspectorTextRow label={message.role === 'user' ? 'User' : 'Agent'} value={message.content} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {selectedNode.payload.kind === 'architecture-run' && (
              <>
                <InspectorRow label="Run" value={shortId(selectedNode.payload.summary.runId)} />
                <InspectorRow label="Schema" value={selectedNode.payload.summary.schemaId} />
                <InspectorRow label="Status" value={selectedNode.payload.summary.status} />
                <InspectorRow label="Routes" value={`${selectedNode.payload.summary.routeHops.length} hop(s)`} />
                <InspectorRow label="Artifact" value={selectedNode.payload.summary.finalArtifact} />
                {selectedNode.payload.route ? (
                  <>
                    <InspectorRow label="Flow" value={`${shortNodeLabel(selectedNode.payload.route.fromNodeId)} -> ${shortNodeLabel(selectedNode.payload.route.toNodeId)}`} />
                    <InspectorRow label="Incomplete" value={selectedNode.payload.route.incompleteReason} />
                    <InspectorRow label="Tool proof" value={selectedNode.payload.route.toolEvidence ? toolEvidenceLabel(selectedNode.payload.route.toolEvidence) : undefined} />
                    <InspectorTextRow label="Preview" value={selectedNode.payload.route.contentPreview} />
                    {showSystemDetails ? (
                      <>
                        <InspectorRow label="Stream" value={selectedNode.payload.route.streamStatus
                          ? `${selectedNode.payload.route.streamStatus}${selectedNode.payload.route.chunkCount !== undefined ? ` / ${selectedNode.payload.route.chunkCount} chunks` : ''}`
                          : undefined} />
                        <InspectorRow label="Branch" value={selectedNode.payload.route.branchSessionId ? shortId(selectedNode.payload.route.branchSessionId) : undefined} />
                      </>
                    ) : null}
                  </>
                ) : null}
              </>
            )}

            {selectedNode.payload.kind === 'tool-result' && (
              <>
                <InspectorRow label="Tool" value={selectedNode.payload.toolName} />
                <InspectorRow label="Reason" value={selectedNode.payload.reason} />
                <InspectorTextRow label="Result" value={prettyPrint(selectedNode.payload.result)} />
              </>
            )}

            {selectedNode.payload.kind === 'artifact' && (
              <>
                <InspectorRow label="Artifact" value={selectedNode.payload.artifact.kind} />
                <InspectorRow label="Path" value={selectedNode.payload.artifact.path ?? selectedNode.payload.artifact.subtitle} />
                <InspectorTextRow label="Preview" value={selectedNode.payload.artifact.preview} />
              </>
            )}

            {selectedNode.payload.kind === 'final-answer' && (
              <InspectorTextRow label="Reply" value={selectedNode.payload.message?.content ?? 'Awaiting reply'} />
            )}
          </section>

          <GraphInspectorActions
            node={selectedNode}
            activeSessionId={activeSessionId}
            selectedConfirmation={selectedConfirmation}
            setActiveSession={setActiveSession}
            onOpenSessionInConversation={onOpenSessionInConversation}
            removePendingConfirmation={removePendingConfirmation}
            setPendingMessage={setPendingMessage}
          />

          {showRawData && (
            <section className="space-y-2.5 rounded-lg border border-base-300 bg-base-200/35 px-3 py-3">
              <div className="flex items-center gap-2">
                {selectedNode.payload.kind === 'artifact' ? <FileImage size={16} /> : <FileCode2 size={16} />}
                <h4 className="text-sm font-semibold tracking-tight">Raw developer payload</h4>
              </div>
              <pre className="max-h-80 overflow-auto rounded-lg bg-[#0c1627] p-3 text-xs leading-5 text-sky-100/90 whitespace-pre-wrap break-words">
                {prettyPrint(selectedNode.payload)}
              </pre>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
