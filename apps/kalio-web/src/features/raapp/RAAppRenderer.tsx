import { useCallback } from 'react';
import { nanoid } from 'nanoid';
import type { RAAppBlock, RAAppResult, ChatMessage, RaAppNativeResult } from '@kalio/types';
import { HtmlIframeRenderer } from './HtmlIframeRenderer';
import { VfsHtmlRenderer } from './VfsHtmlRenderer';
import { isHtmlString, findHtmlInData, injectEngineCDN } from './raappRendererUtils';
import { GuiDslRenderer, type GuiDslPayload } from './GuiDslRenderer';
import { RaAppHITLOverlay } from './RaAppHITLOverlay';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { eventBus } from '../../services/eventBus';
import { resolveLiveTurnState } from '../chat/liveTurnState';

interface RAAppRendererProps {
  block: RAAppBlock;
  result?: RAAppResult;
  sessionId?: string;
}

function stringifyNativeResult(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    console.debug('[RAAppRenderer] Failed to stringify value', err);
    return String(value);
  }
}

function NativeResultsPanel({ results }: { results: RaAppNativeResult[] }) {
  if (results.length === 0) {
    return null;
  }

  return (
    <div data-testid="raapp-native-results" className="mt-3 rounded-xl border border-base-300/70 bg-base-200/50 p-3 text-xs">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-base-content/55">Native operations</div>
      <div className="space-y-2">
        {results.map((result) => (
          <div key={result.id} className="rounded-lg border border-base-300/60 bg-base-100/70 p-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] text-base-content/80">{result.system}</span>
              <span className="text-[10px] uppercase tracking-wide text-base-content/45">{result.status}</span>
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] text-base-content/65">
              {result.status === 'error'
                ? result.error ?? 'Execution failed'
                : stringifyNativeResult(result.result)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function safeParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch (err) {
    void err;
    return null;
  }
}

export function RAAppRenderer({ block, result, sessionId }: RAAppRendererProps) {
  const {
    activeSessionId,
    sessions,
    messages,
    agentTurns,
    streamingChunks,
    thinkingChunks,
    chunkSessionIds,
    getSessionActiveTurnId,
  } = useSessionStore((state) => ({
    activeSessionId: state.activeSessionId,
    sessions: state.sessions,
    messages: state.messages,
    agentTurns: state.agentTurns,
    streamingChunks: state.streamingChunks,
    thinkingChunks: state.thinkingChunks,
    chunkSessionIds: state.chunkSessionIds,
    getSessionActiveTurnId: state.getSessionActiveTurnId,
  }));
  const { getToolActivitiesForSession, hasActiveLoopForSession, queuedDepthBySession } = useAgentStore((state) => ({
    getToolActivitiesForSession: state.getToolActivitiesForSession,
    hasActiveLoopForSession: state.hasActiveLoopForSession,
    queuedDepthBySession: state.queuedDepthBySession,
  }));
  const activeSessionLiveTurn = resolveLiveTurnState({
    sessionId: activeSessionId,
    sessionMessages: messages,
    agentTurns,
    activeTurnId: getSessionActiveTurnId(activeSessionId),
    isStreaming: false,
    awaitingFirstChunk: false,
    hasActiveLoop: hasActiveLoopForSession(activeSessionId),
    queuedDepth: activeSessionId ? (queuedDepthBySession[activeSessionId] ?? 0) : 0,
    activeToolActivities: getToolActivitiesForSession(activeSessionId),
    streamingChunks,
    thinkingChunks,
    chunkSessionIds,
  });
  const shouldQueueGuiAction = activeSessionLiveTurn.phase !== 'idle';

  const handleGuiAction = useCallback(
    (action: string) => {
      if (!activeSessionId) return;
      const session = sessions.find((s) => s.id === activeSessionId);
      if (!session) return;

      if (shouldQueueGuiAction) {
        const { enqueueUserAction } = useSessionStore.getState();
        enqueueUserAction(action);
        return;
      }

      const { addMessage } = useSessionStore.getState();
      const userMsg: ChatMessage = {
        id: nanoid(),
        sessionId: activeSessionId,
        role: 'user',
        content: action,
        createdAt: Date.now(),
      };
      addMessage(userMsg);
      eventBus.sendMessage({ sessionId: activeSessionId, content: action, personaId: session.personaId });
    },
    [activeSessionId, sessions, shouldQueueGuiAction],
  );

  if (result?.status === 'error') {
    return (
      <div data-testid="raapp-error" className="alert alert-error py-2 text-xs">
        <span>{result.error?.code}: </span>
        <span>{result.error?.message}</span>
        {result.error?.line !== undefined && <span> (line {result.error.line})</span>}
      </div>
    );
  }

  const pendingApprovals = block.pendingApprovals ?? result?.pendingApprovals ?? [];
  const nativeResults = block.nativeResults ?? result?.nativeResults ?? [];

  const content = result?.renderedContent ?? block.content;

  const hitlOverlay =
    pendingApprovals.length > 0 ? (
      <RaAppHITLOverlay pendingApprovals={pendingApprovals} />
    ) : null;
  const nativeResultsPanel = <NativeResultsPanel results={nativeResults} />;

  if (block.type === 'html') {
    const previewSessionId = sessionId ?? activeSessionId;
    if (block.vfsPath && previewSessionId) {
      return (
        <>
          <VfsHtmlRenderer sessionId={previewSessionId} vfsPath={block.vfsPath} title="RA-App" />
          {nativeResultsPanel}
          {hitlOverlay}
        </>
      );
    }
    const html = injectEngineCDN(content, (block as { engine?: string }).engine);
    return (
      <>
        <HtmlIframeRenderer html={html} title="RA-App" mode={block.mode} />
        {nativeResultsPanel}
        {hitlOverlay}
      </>
    );
  }

  if (block.type === 'gui') {
    // Try to parse as GUI DSL payload {nodes, data}
    const parsed = typeof content === 'string' ? safeParseJson(content) : content;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'nodes' in parsed &&
      Array.isArray((parsed as GuiDslPayload).nodes) &&
      'data' in parsed &&
      typeof (parsed as GuiDslPayload).data === 'object' &&
      (parsed as GuiDslPayload).data !== null
    ) {
      return (
        <>
          <GuiDslRenderer payload={parsed as GuiDslPayload} onAction={handleGuiAction} />
          {nativeResultsPanel}
          {hitlOverlay}
        </>
      );
    }

    // Fallback: sniff raw HTML in content
    if (isHtmlString(content)) {
      return (
        <>
          <HtmlIframeRenderer html={content} title="RA-App" mode={block.mode} />
          {nativeResultsPanel}
          {hitlOverlay}
        </>
      );
    }
    const sniffed = findHtmlInData(parsed);
    if (sniffed) {
      return (
        <>
          <HtmlIframeRenderer html={sniffed} title="RA-App" mode={block.mode} />
          {nativeResultsPanel}
          {hitlOverlay}
        </>
      );
    }
  }

  return (
    <>
      <div data-testid="raapp-gui" className="rounded border border-base-300 p-3 text-xs whitespace-pre-wrap font-mono">
        {content}
      </div>
      {nativeResultsPanel}
      {hitlOverlay}
    </>
  );
}
