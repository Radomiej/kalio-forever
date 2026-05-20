import { FileCode2, FileImage } from 'lucide-react';
import type { ToolConfirmationRequest } from '@kalio/types';
import { ExecutionGraphPreviewPanel } from './ExecutionGraphPreview';
import { GraphInspectorActions } from './GraphInspectorActions';
import type { ExecutionGraphNode, ExecutionGraphNodePayload } from './executionGraphModel';

function prettyPrint(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
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
    case 'artifact':
      return 'Artifact details';
    case 'final-answer':
      return 'Final response';
  }
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

interface ExecutionGraphInspectorProps {
  activeSessionId: string;
  inspectorWidth: number;
  selectedConfirmation: ToolConfirmationRequest | null;
  selectedNode: ExecutionGraphNode | null;
  setActiveSession: (sessionId: string | null) => void;
  setPendingConfirmation: (sessionId: string, confirmation: ToolConfirmationRequest | null) => void;
  setPendingMessage: (message: string | null) => void;
}

export function ExecutionGraphInspector({
  activeSessionId,
  inspectorWidth,
  selectedConfirmation,
  selectedNode,
  setActiveSession,
  setPendingConfirmation,
  setPendingMessage,
}: ExecutionGraphInspectorProps) {
  return (
    <aside
      data-testid="execution-graph-inspector"
      className="shrink-0 border-l border-base-300 bg-base-100 overflow-y-auto"
      style={{ width: `${inspectorWidth}px` }}
    >
      {selectedNode && (
        <div className="p-5 space-y-5">
          <div className="rounded-[22px] border border-base-300 bg-base-200/35 px-5 py-4">
            <h3 className="text-3xl font-black tracking-tight">Node Inspector</h3>
            <p className="mt-1 text-sm text-base-content/55">selected: {selectedNode.title}</p>
          </div>

          <ExecutionGraphPreviewPanel node={selectedNode} fallbackSessionId={activeSessionId} />

          <section className="rounded-[22px] border border-base-300 bg-base-200/35 px-5 py-4 space-y-3">
            <h4 className="text-xl font-black tracking-tight">{payloadTitle(selectedNode.payload)}</h4>
            <InspectorRow label="Status" value={statusLabel(selectedNode.status)} />
            <InspectorRow label="Session" value={selectedNode.sessionId ?? activeSessionId} />
            <InspectorRow label="Type" value={selectedNode.kind} />
            {'callId' in selectedNode && selectedNode.callId ? <InspectorRow label="Call ID" value={selectedNode.callId} /> : null}

            {selectedNode.payload.kind === 'turn' && (
              <>
                <InspectorRow label="Persona" value={selectedNode.payload.actorLabel} />
                <InspectorRow label="Model" value={selectedNode.payload.modelLabel} />
                <InspectorRow label="Tools" value={String(selectedNode.payload.toolCount)} />
                <InspectorRow label="Thinking" value={String(selectedNode.payload.thinkingCount)} />
                <InspectorRow label="Preview" value={selectedNode.payload.textPreview} />
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
                    <InspectorRow label="Context" value={selectedNode.payload.inputPrompt} />
                    <InspectorRow label="Mode" value={selectedNode.payload.result.vfsMode ?? 'shared'} />
                    <InspectorRow label="Artifacts" value={`${selectedNode.payload.copiedFiles.length} file(s)`} />
                  </>
                ) : (
                  <>
                    <InspectorRow label="Agent" value={selectedNode.payload.snapshot.agentId} />
                    <InspectorRow label="Workdir" value={selectedNode.payload.snapshot.workdir} />
                    <InspectorRow label="Prompt" value={selectedNode.payload.inputPrompt} />
                    <InspectorRow label="Exit" value={selectedNode.payload.snapshot.lastExitCode !== undefined ? String(selectedNode.payload.snapshot.lastExitCode) : undefined} />
                    <InspectorRow label="Output" value={selectedNode.payload.snapshot.lastOutput} />
                  </>
                )}
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
              <InspectorRow label="Reply" value={selectedNode.payload.message?.content ?? 'Awaiting reply'} />
            )}
          </section>

          <GraphInspectorActions
            node={selectedNode}
            activeSessionId={activeSessionId}
            selectedConfirmation={selectedConfirmation}
            setActiveSession={setActiveSession}
            setPendingConfirmation={setPendingConfirmation}
            setPendingMessage={setPendingMessage}
          />

          <section className="rounded-[22px] border border-base-300 bg-base-200/35 px-5 py-4 space-y-3">
            <div className="flex items-center gap-2">
              {selectedNode.payload.kind === 'artifact' ? <FileImage size={16} /> : <FileCode2 size={16} />}
              <h4 className="text-xl font-black tracking-tight">Raw node data</h4>
            </div>
            <pre className="rounded-2xl bg-[#0c1627] text-sky-100/90 p-4 text-xs leading-6 overflow-x-auto whitespace-pre-wrap break-words">
              {prettyPrint(selectedNode.payload)}
            </pre>
          </section>
        </div>
      )}
    </aside>
  );
}
