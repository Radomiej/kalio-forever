import { useState, useEffect } from 'react';
import type { CLIAgentSessionSnapshot, RAAppBlock, SubagentToolResult, SubAgentFlowResult } from '@kalio/types';
import { RAAppRenderer } from '../raapp/RAAppRenderer';
import { ImageResultRenderer, type ImageResultData } from './ImageResultRenderer';
import { extractChildToolPreviews, getChildImageIdentity } from './ToolCallBubble.parsers';
import { DEFAULT_CHILD_SESSION_HISTORY_LIMIT, fetchSessionHistoryWindow } from './sessionHistoryApi';

function statusTone(status: SubAgentFlowResult['status']): string {
  if (status === 'done') return 'text-success';
  if (status === 'failed' || status === 'blocked' || status === 'cancelled') return 'text-error';
  if (status === 'waiting_on_orchestrator') return 'text-warning';
  return 'text-info';
}

export function SubAgentFlowResultBlock({ result }: { result: SubAgentFlowResult }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const openChatId = result.openChatSessionId ?? result.childSessionId;
  const openGraphId = result.openGraphRunId ?? result.flowRunId;
  const hasDetails = result.decisions.length > 0
    || result.nextActions.length > 0
    || result.artifacts.length > 0
    || (result.tracePreview?.length ?? 0) > 0;

  return (
    <div className="space-y-2" data-testid="sub-agentflow-result">
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px] font-mono text-base-content/60 bg-base-200/60 rounded px-2 py-1.5">
        <span className="text-base-content/35">flow</span>
        <span className="truncate">{result.flowRunId}</span>
        <span className="text-base-content/35">status</span>
        <span className={statusTone(result.status)}>{result.status}</span>
        <span className="text-base-content/35">chat</span>
        <span className="truncate">{openChatId}</span>
        <span className="text-base-content/35">graph</span>
        <span className="truncate">{openGraphId}</span>
        {result.returnToOrchestratorCount !== undefined && (
          <>
            <span className="text-base-content/35">handoffs</span>
            <span>{result.returnToOrchestratorCount}</span>
          </>
        )}
        {hasDetails && (
          <>
            <span className="text-base-content/35">details</span>
            <button
              type="button"
              className="justify-self-start text-sky-400/70 hover:text-sky-400 transition-colors"
              onClick={() => setDetailsOpen((value) => !value)}
              aria-label="Toggle AgentFlow details"
            >
              {detailsOpen ? 'hide' : 'show'}
            </button>
          </>
        )}
      </div>
      <div className="text-xs text-base-content/70 bg-base-200/40 rounded px-2 py-1.5 whitespace-pre-wrap">
        {result.summary}
      </div>
      {detailsOpen && (
        <div className="space-y-2 text-xs text-base-content/60 bg-base-200/40 rounded px-2 py-1.5">
          {result.decisions.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/35">decisions</div>
              {result.decisions.map((decision) => <div key={decision}>- {decision}</div>)}
            </div>
          )}
          {result.nextActions.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/35">next</div>
              {result.nextActions.map((action) => <div key={action}>- {action}</div>)}
            </div>
          )}
          {result.tracePreview && result.tracePreview.length > 0 && (
            <div className="font-mono text-[11px] max-h-32 overflow-y-auto">
              {result.tracePreview.map((event) => (
                <div key={event.id} className="truncate">
                  {event.sequence}. {event.type} {event.nodeId ? `(${event.nodeId})` : ''}: {event.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SubagentResultBlock({ result }: { result: SubagentToolResult }) {
  const [childRaapp, setChildRaapp] = useState<RAAppBlock | null>(null);
  const [childImages, setChildImages] = useState<ImageResultData[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasVerboseResult = result.result.trim().length > 0;
  const hasCopiedFiles = result.copiedFiles.length > 0;
  const hasDetails = hasVerboseResult || hasCopiedFiles;

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    void fetchSessionHistoryWindow(result.childSessionId, {
      limit: DEFAULT_CHILD_SESSION_HISTORY_LIMIT,
      signal: abortController.signal,
    })
      .then((response) => {
        if (cancelled) return;
        const previews = extractChildToolPreviews(response.messages);
        setChildRaapp(previews.raapp);
        setChildImages(previews.images);
      })
      .catch((err: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }
        console.error('[ToolCallBubble] failed to load subagent messages for child previews', err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [result.childSessionId]);

  return (
    <div className="space-y-2">
      {childRaapp && <RAAppRenderer block={childRaapp} sessionId={result.childSessionId} />}
      {childImages.length > 0 && (
        <div className="space-y-3">
          {childImages.map((image) => (
            <ImageResultRenderer
              key={getChildImageIdentity(image)}
              data={image}
            />
          ))}
        </div>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px] font-mono text-base-content/60 bg-base-200/60 rounded px-2 py-1.5">
        <span className="text-base-content/35">session</span>
        <span className="truncate">{result.childSessionId}</span>
        <span className="text-base-content/35">vfs</span>
        <span>{result.vfsMode}</span>
        <span className="text-base-content/35">copied</span>
        <span>{result.copiedFiles.length}</span>
        {hasDetails && (
          <>
            <span className="text-base-content/35">details</span>
            <button
              type="button"
              className="justify-self-start text-sky-400/70 hover:text-sky-400 transition-colors"
              onClick={() => setDetailsOpen((value) => !value)}
              aria-label="Toggle sub-agent details"
            >
              {detailsOpen ? 'hide' : 'show'}
            </button>
          </>
        )}
      </div>
      {detailsOpen && hasVerboseResult && (
        <div className="text-xs text-base-content/60 bg-base-200/40 rounded px-2 py-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap">
          {result.result}
        </div>
      )}
      {detailsOpen && hasCopiedFiles && (
        <div className="font-mono text-[11px] text-base-content/50 bg-base-200/40 rounded px-2 py-1.5 max-h-32 overflow-y-auto">
          {result.copiedFiles.map((file) => (
            <div key={file.toPath} className="truncate">{file.toPath}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CLIAgentSessionStatusBlock({ snapshot }: { snapshot: CLIAgentSessionSnapshot }) {
  const statusTone = snapshot.status === 'failed'
    ? 'text-error'
    : snapshot.status === 'stopped'
      ? 'text-warning'
      : snapshot.status === 'completed'
        ? 'text-success'
        : snapshot.status === 'running'
          ? 'text-info'
          : 'text-base-content/60';

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px] font-mono text-base-content/60 bg-base-200/60 rounded px-2 py-1.5">
        <span className="text-base-content/35">session</span>
        <span className="truncate">{snapshot.childSessionId}</span>
        <span className="text-base-content/35">status</span>
        <span className={statusTone}>{snapshot.status}</span>
        <span className="text-base-content/35">agent</span>
        <span>{snapshot.agentId}</span>
        {snapshot.lastExitCode !== undefined && (
          <>
            <span className="text-base-content/35">exit</span>
            <span>{snapshot.lastExitCode}</span>
          </>
        )}
        {snapshot.workdir.trim().length > 0 && (
          <>
            <span className="text-base-content/35">workdir</span>
            <span className="truncate">{snapshot.workdir}</span>
          </>
        )}
      </div>
      {snapshot.lastOutput && (
        <pre className="text-[11px] text-base-content/70 bg-neutral/60 rounded px-2 py-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
          {snapshot.lastOutput}
        </pre>
      )}
    </div>
  );
}
