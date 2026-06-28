import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatAttachment, ChatSession, LLMContextPreview } from '@kalio/types';
import type { TokenCount } from '../../../services/tokenCounter';
import { apiClient } from '../../../services/apiClient';
import { isPendingHostSession, isPendingHostSessionId } from '../pendingHostSession';

export interface ContextPreviewStatus {
  loading: boolean;
  stale: boolean;
  error: string | null;
}

interface UseContextPreviewOptions {
  sessionId: string | null;
  session?: ChatSession | null;
  personaId: string | null;
  draftUserMessage?: string;
  attachments?: ChatAttachment[];
  refreshKey: number;
}

interface ContextPreviewResult {
  preview: LLMContextPreview | null;
  tokenCount: TokenCount | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
  invalidate: () => void;
}

function tokenCountFromPreview(preview: LLMContextPreview): TokenCount {
  const breakdown = {
    tools: preview.estimatedTokens.tools,
    systemPrompt: preview.estimatedTokens.systemPrompt,
    skills: 0,
    history: preview.estimatedTokens.history + preview.estimatedTokens.reasoning,
    images: preview.estimatedTokens.images,
  };
  const total = preview.estimatedTokens.total;
  return {
    total,
    breakdown,
    cacheable: breakdown.systemPrompt + breakdown.tools + breakdown.skills,
    contextLimit: preview.contextLimit,
    usagePercent: preview.contextLimit > 0 ? Math.round((total / preview.contextLimit) * 100) : 0,
  };
}

export function useContextPreview({
  sessionId,
  session,
  personaId,
  draftUserMessage,
  attachments,
  refreshKey,
}: UseContextPreviewOptions): ContextPreviewResult {
  const [preview, setPreview] = useState<LLMContextPreview | null>(null);
  const [tokenCount, setTokenCount] = useState<TokenCount | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualRefreshKey, setManualRefreshKey] = useState(0);
  const requestSeqRef = useRef(0);
  const previewRef = useRef<LLMContextPreview | null>(null);
  const attachmentsSignature = JSON.stringify(attachments ?? []);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  const invalidate = useCallback(() => {
    setManualRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!sessionId || !personaId || isPendingHostSession(session) || isPendingHostSessionId(sessionId)) {
      requestSeqRef.current += 1;
      setPreview(null);
      setTokenCount(null);
      setLoading(false);
      setStale(false);
      setError(null);
      return;
    }

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setLoading(true);
    setStale(previewRef.current !== null);
    setError(null);

    const timeout = window.setTimeout(() => {
      apiClient
        .post<LLMContextPreview>(`/api/sessions/${encodeURIComponent(sessionId)}/context-preview`, {
          personaId,
          draftUserMessage,
          attachments,
        })
        .then((response) => {
          if (requestSeqRef.current !== requestSeq) return;
          setPreview(response.data);
          setTokenCount(tokenCountFromPreview(response.data));
          setLoading(false);
          setStale(false);
        })
        .catch((err: unknown) => {
          if (requestSeqRef.current !== requestSeq) return;
          setError(err instanceof Error ? err.message : 'Context preview failed');
          setLoading(false);
          setStale(previewRef.current !== null);
        });
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [attachments, attachmentsSignature, draftUserMessage, manualRefreshKey, personaId, refreshKey, session, sessionId]);

  return {
    preview,
    tokenCount,
    loading,
    stale,
    error,
    invalidate,
  };
}
