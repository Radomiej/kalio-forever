import { useState } from 'react';
import {
  Bot, Boxes, BrainCircuit, CheckCircle2, FileCode2, FileImage, FolderTree, MessageSquareText, Wrench,
} from 'lucide-react';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import {
  buildExecutionGraphModel,
  type ExecutionGraphNode,
  type ExecutionGraphNodeKind,
  type ExecutionGraphNodePayload,
} from './executionGraphModel';

const NODE_COLORS: Record<ExecutionGraphNodeKind, string> = {
  prompt: 'from-sky-600/85 to-cyan-500/75 border-sky-300/40',
  turn: 'from-violet-600/85 to-fuchsia-500/75 border-violet-200/40',
  'tool-group': 'from-emerald-600/80 to-teal-500/75 border-emerald-200/40',
  tool: 'from-amber-600/85 to-orange-500/75 border-amber-200/40',
  subagent: 'from-indigo-600/85 to-violet-500/75 border-indigo-200/40',
  artifact: 'from-slate-600/85 to-slate-500/75 border-slate-200/40',
  'final-answer': 'from-green-700/85 to-emerald-500/75 border-emerald-100/45',
};

function prettyPrint(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function nodeIcon(kind: ExecutionGraphNodeKind) {
  switch (kind) {
    case 'prompt':
      return <MessageSquareText size={16} />;
    case 'turn':
      return <Bot size={16} />;
    case 'tool-group':
      return <Boxes size={16} />;
    case 'tool':
      return <Wrench size={16} />;
    case 'subagent':
      return <BrainCircuit size={16} />;
    case 'artifact':
      return <FolderTree size={16} />;
    case 'final-answer':
      return <CheckCircle2 size={16} />;
  }
}

function statusTone(status: ExecutionGraphNode['status']): string {
  if (status === 'error') return 'text-rose-200';
  if (status === 'running') return 'text-amber-100';
  if (status === 'success') return 'text-emerald-100';
  return 'text-slate-200';
}

function statusLabel(status: ExecutionGraphNode['status']): string {
  if (status === 'error') return 'error';
  if (status === 'running') return 'running';
  if (status === 'success') return 'ready';
  return 'idle';
}

function payloadTitle(payload: ExecutionGraphNodePayload): string {
  switch (payload.kind) {
    case 'prompt':
      return 'Prompt payload';
    case 'turn':
      return 'Turn payload';
    case 'tool':
      return 'Tool payload';
    case 'tool-group':
      return 'Grouped tools';
    case 'subagent':
      return 'Subagent summary';
    case 'artifact':
      return 'Artifact payload';
    case 'final-answer':
      return 'Final answer';
  }
}

function GraphNodeCard({
  node,
  selected,
  onSelect,
}: {
  node: ExecutionGraphNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`graph-node-${node.id}`}
      className={`absolute text-left rounded-[22px] border bg-gradient-to-br px-4 py-3 shadow-[0_18px_30px_rgba(2,12,27,0.28)] transition-all ${NODE_COLORS[node.kind]} ${selected ? 'ring-2 ring-sky-300/85 scale-[1.01]' : 'hover:scale-[1.01] hover:shadow-[0_20px_34px_rgba(2,12,27,0.34)]'}`}
      style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`inline-flex items-center gap-2 text-sm font-semibold ${statusTone(node.status)}`}>
            {nodeIcon(node.kind)}
            <span className="truncate">{node.title}</span>
          </div>
          <p className="mt-2 text-sm text-white/90 line-clamp-2 break-words">{node.subtitle}</p>
        </div>
        <span className="rounded-full border border-white/15 bg-black/15 px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-white/80">
          {statusLabel(node.status)}
        </span>
      </div>
      {node.detail && <p className="mt-3 text-xs text-white/72 line-clamp-2 break-words">{node.detail}</p>}
    </button>
  );
}

function InspectorRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[88px,1fr] gap-3 text-sm">
      <span className="text-base-content/45">{label}</span>
      <span className="text-base-content/85 break-words">{value}</span>
    </div>
  );
}

export function ExecutionGraphView() {
  const { activeSessionId, messages, agentTurns, sessions, sessionMessages, setActiveSession } = useSessionStore();
  const { toolActivities, activeAgentLoops } = useAgentStore();
  const [collapseTools, setCollapseTools] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  if (!activeSessionId) {
    return (
      <div data-testid="execution-graph-view" className="h-full flex items-center justify-center bg-base-100 text-base-content/55">
        Open a chat session to inspect its execution graph.
      </div>
    );
  }

  const model = buildExecutionGraphModel({
    sessionId: activeSessionId,
    messages,
    turns: agentTurns,
    toolActivities,
    activeAgentLoops,
    sessions,
    sessionMessages,
    collapseTools,
  });

  const effectiveSelectedId = model.nodes.some((node) => node.id === selectedNodeId)
    ? selectedNodeId
    : model.defaultSelectedNodeId;
  const selectedNode = model.nodes.find((node) => node.id === effectiveSelectedId) ?? null;

  if (model.nodes.length === 0) {
    return (
      <div data-testid="execution-graph-view" className="h-full flex items-center justify-center bg-base-100 text-base-content/55">
        Send a message to generate the first execution branch.
      </div>
    );
  }

  return (
    <div data-testid="execution-graph-view" className="flex h-full overflow-hidden bg-base-100">
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-base-300 bg-base-100 flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2 className="text-2xl font-black tracking-tight">Execution Graph</h2>
            <p className="text-sm text-base-content/45">Prompt roots, orchestration turns, tools, subagents, artifacts and final answers.</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${collapseTools ? 'border-sky-500 bg-sky-500/12 text-sky-300' : 'border-base-300 text-base-content/70 hover:text-base-content'}`}
              onClick={() => setCollapseTools((value) => !value)}
            >
              Collapse tools
            </button>
            <span className="rounded-full border border-base-300 px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-base-content/45">
              Live from store state
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.10),_transparent_42%),linear-gradient(rgba(56,189,248,0.08)_1px,_transparent_1px),linear-gradient(90deg,_rgba(56,189,248,0.08)_1px,_transparent_1px)] bg-[length:100%_100%,40px_40px,40px_40px] bg-[#0a1220]">
          <div className="relative" style={{ width: model.board.width, height: model.board.height }}>
            <svg className="absolute inset-0 overflow-visible" width={model.board.width} height={model.board.height} aria-hidden="true">
              <defs>
                <marker id="graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(125, 211, 252, 0.85)" />
                </marker>
              </defs>
              {model.edges.map((edge) => {
                const source = model.nodes.find((node) => node.id === edge.sourceId);
                const target = model.nodes.find((node) => node.id === edge.targetId);
                if (!source || !target) return null;

                const startX = source.x + source.width;
                const startY = source.y + source.height / 2;
                const endX = target.x;
                const endY = target.y + target.height / 2;
                const delta = Math.max((endX - startX) / 2, 40);
                const path = `M ${startX} ${startY} C ${startX + delta} ${startY}, ${endX - delta} ${endY}, ${endX} ${endY}`;

                return (
                  <path
                    key={edge.id}
                    d={path}
                    fill="none"
                    markerEnd="url(#graph-arrow)"
                    stroke={edge.style === 'dashed' ? 'rgba(148,163,184,0.6)' : 'rgba(125,211,252,0.9)'}
                    strokeDasharray={edge.style === 'dashed' ? '7 8' : undefined}
                    strokeWidth={edge.style === 'dashed' ? 2 : 3}
                  />
                );
              })}
            </svg>

            {model.nodes.map((node) => (
              <GraphNodeCard
                key={node.id}
                node={node}
                selected={node.id === effectiveSelectedId}
                onSelect={() => setSelectedNodeId(node.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <aside className="w-[24rem] shrink-0 border-l border-base-300 bg-base-100 overflow-y-auto">
        {selectedNode && (
          <div className="p-5 space-y-5">
            <div className="rounded-[22px] border border-base-300 bg-base-200/35 px-5 py-4">
              <h3 className="text-3xl font-black tracking-tight">Node Inspector</h3>
              <p className="mt-1 text-sm text-base-content/55">selected: {selectedNode.title}</p>
            </div>

            <section className="rounded-[22px] border border-base-300 bg-base-200/35 px-5 py-4 space-y-3">
              <h4 className="text-xl font-black tracking-tight">{payloadTitle(selectedNode.payload)}</h4>
              <InspectorRow label="Status" value={statusLabel(selectedNode.status)} />
              <InspectorRow label="Session" value={selectedNode.sessionId ?? activeSessionId} />
              <InspectorRow label="Type" value={selectedNode.kind} />
              {'callId' in selectedNode && selectedNode.callId ? <InspectorRow label="Call" value={selectedNode.callId} /> : null}

              {selectedNode.payload.kind === 'turn' && (
                <>
                  <InspectorRow label="Tools" value={String(selectedNode.payload.toolCount)} />
                  <InspectorRow label="Thinking" value={String(selectedNode.payload.thinkingCount)} />
                  <InspectorRow label="Preview" value={selectedNode.payload.textPreview} />
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

              {selectedNode.payload.kind === 'subagent' && (
                <>
                  <InspectorRow label="Mode" value={selectedNode.payload.result.vfsMode ?? 'shared'} />
                  <InspectorRow label="Artifacts" value={`${selectedNode.payload.copiedFiles.length} file(s)`} />
                  {selectedNode.payload.transcript.length > 0 && (
                    <div>
                      <p className="text-sm text-base-content/45 mb-2">Transcript tail</p>
                      <div className="space-y-2">
                        {selectedNode.payload.transcript.slice(-3).map((message) => (
                          <div key={message.id} className="rounded-xl border border-base-300/70 bg-base-100/65 px-3 py-2 text-sm">
                            <span className="text-base-content/45 mr-2">{message.role === 'user' ? 'User' : 'Agent'}</span>
                            <span className="text-base-content/85">{message.content}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {selectedNode.payload.kind === 'artifact' && (
                <>
                  <InspectorRow label="Artifact" value={selectedNode.payload.artifact.kind} />
                  <InspectorRow label="Path" value={selectedNode.payload.artifact.path ?? selectedNode.payload.artifact.subtitle} />
                  <InspectorRow label="Preview" value={selectedNode.payload.artifact.preview} />
                </>
              )}

              {selectedNode.payload.kind === 'final-answer' && (
                <InspectorRow label="Answer" value={selectedNode.payload.message?.content ?? 'Awaiting answer'} />
              )}
            </section>

            {selectedNode.payload.kind === 'subagent' && selectedNode.sessionId && selectedNode.sessionId !== activeSessionId && (
              <section className="rounded-[22px] border border-base-300 bg-base-200/35 px-5 py-4 space-y-3">
                <h4 className="text-xl font-black tracking-tight">Actions</h4>
                <button
                  type="button"
                  className="w-full rounded-xl bg-sky-500/85 hover:bg-sky-500 text-white px-4 py-3 text-sm font-medium transition-colors"
                  onClick={() => setActiveSession(selectedNode.sessionId ?? null)}
                >
                  Open child chat
                </button>
              </section>
            )}

            <section className="rounded-[22px] border border-base-300 bg-base-200/35 px-5 py-4 space-y-3">
              <div className="flex items-center gap-2">
                {selectedNode.payload.kind === 'artifact' ? <FileImage size={16} /> : <FileCode2 size={16} />}
                <h4 className="text-xl font-black tracking-tight">Node payload preview</h4>
              </div>
              <pre className="rounded-2xl bg-[#0c1627] text-sky-100/90 p-4 text-xs leading-6 overflow-x-auto whitespace-pre-wrap break-words">
                {prettyPrint(selectedNode.payload)}
              </pre>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}