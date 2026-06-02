import type { RefObject } from 'react';

type ToolArgProgress = { toolName: string; totalChars: number; charsPerSec: number };

interface ToolArgProgressHandlersOptions {
  toolArgProgressSeenRef: RefObject<Record<string, Set<string>>>;
  setToolArgProgress: (progress: ToolArgProgress | null) => void;
  getActiveSessionId: () => string | null;
}

export function createToolArgProgressHandlers({
  toolArgProgressSeenRef,
  setToolArgProgress,
  getActiveSessionId,
}: ToolArgProgressHandlersOptions) {
  const markToolArgProgressSeen = (sessionId: string, toolName: string) => {
    const seenForSession = toolArgProgressSeenRef.current[sessionId] ?? new Set<string>();
    seenForSession.add(toolName);
    toolArgProgressSeenRef.current[sessionId] = seenForSession;
  };

  const clearToolArgProgressTracking = (sessionId?: string | null) => {
    if (!sessionId) {
      toolArgProgressSeenRef.current = {};
      setToolArgProgress(null);
      return;
    }
    delete toolArgProgressSeenRef.current[sessionId];
    if (sessionId === getActiveSessionId()) {
      setToolArgProgress(null);
    }
  };

  const ensureSyntheticToolIntent = (sessionId: string | null | undefined, toolName: string) => {
    if (!sessionId || sessionId !== getActiveSessionId()) {
      return;
    }
    if (toolArgProgressSeenRef.current[sessionId]?.has(toolName)) {
      return;
    }
    setToolArgProgress({ toolName, totalChars: 0, charsPerSec: 0 });
  };

  return {
    markToolArgProgressSeen,
    clearToolArgProgressTracking,
    ensureSyntheticToolIntent,
  };
}

interface ComposerReleaseState {
  hasActiveTurn: boolean;
  hasActiveLoop: boolean;
  hasActiveTool: boolean;
  hasPendingChunks: boolean;
}

export function canReleaseComposerAfterToolResult({
  hasActiveTurn,
  hasActiveLoop,
  hasActiveTool,
  hasPendingChunks,
}: ComposerReleaseState): boolean {
  if (!hasActiveTurn) {
    return true;
  }

  return !hasActiveLoop && !hasActiveTool && !hasPendingChunks;
}
