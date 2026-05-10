import { useCallback } from 'react';
import { nanoid } from 'nanoid';
import type { RAAppBlock, RAAppResult, ChatMessage } from '@kalio/types';
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

  const content = result?.renderedContent ?? block.content;

  const hitlOverlay =
    pendingApprovals.length > 0 ? (
      <RaAppHITLOverlay pendingApprovals={pendingApprovals} />
    ) : null;

  if (block.type === 'html') {
    const previewSessionId = sessionId ?? activeSessionId;
    if (block.vfsPath && previewSessionId) {
      return (
        <>
          <VfsHtmlRenderer sessionId={previewSessionId} vfsPath={block.vfsPath} title="RA-App" />
          {hitlOverlay}
        </>
      );
    }
    const html = injectEngineCDN(content, (block as { engine?: string }).engine);
    return (
      <>
        <HtmlIframeRenderer html={html} title="RA-App" />
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
      {hitlOverlay}
    </>
  );
}
