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
  } catch {
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

export function RAAppRenderer({ block, result, sessionId }: RAAppRendererProps) {
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const handleGuiAction = useCallback(
    (action: string) => {
      const { activeSessionId, sessions, addMessage, enqueueUserAction } = useSessionStore.getState();
      if (!activeSessionId) return;
      const session = sessions.find((s) => s.id === activeSessionId);
      if (!session) return;

      // Queue action if agent is still streaming (prevents mid-stream widget clicks)
      if (isStreaming) {
        enqueueUserAction(action);
        return;
      }

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
    [isStreaming],
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
        <HtmlIframeRenderer html={html} title="RA-App" />
        {nativeResultsPanel}
        {hitlOverlay}
      </>
    );
  }

  if (block.type === 'gui') {
    // Try to parse as GUI DSL payload {nodes, data}
    try {
      const parsed: unknown = typeof content === 'string' ? JSON.parse(content) : content;
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
    } catch {
      // not JSON — fall through
    }

    // Fallback: sniff raw HTML in content
    if (isHtmlString(content)) {
      return (
        <>
          <HtmlIframeRenderer html={content} title="RA-App" />
          {nativeResultsPanel}
          {hitlOverlay}
        </>
      );
    }
    try {
      const parsed: unknown = typeof content === 'string' ? JSON.parse(content) : content;
      const sniffed = findHtmlInData(parsed);
      if (sniffed) {
        return (
          <>
            <HtmlIframeRenderer html={sniffed} title="RA-App" />
            {nativeResultsPanel}
            {hitlOverlay}
          </>
        );
      }
    } catch {
      // not JSON
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
