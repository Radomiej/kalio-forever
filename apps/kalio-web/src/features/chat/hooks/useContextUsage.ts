/**
 * useContextUsage — memoized token counting + compact trigger for the chat.
 *
 * Reads from stores to estimate context usage without duplicating buildSystemPrompt.
 */
import { useMemo, useCallback } from 'react';
import type { ChatMessage } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { countTokens, type TokenCount, type CountTokensInput } from '../../../services/tokenCounter';
import { getCompactStrategy } from '../../../services/compactStrategy';
import { buildHistory } from '../buildHistory';
import type { LLMHistoryMessage } from '../buildHistory';
import { getToolCallingPrompt, getCoreOsPrompt } from '../../../services/modelPrompts';
import { useSettingsStore } from '../../settings/settingsStore';
import type { RawContextStats } from '../ContextStats';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Flatten an LLMHistoryMessage's content to a plain string for token estimation. */
function messageToText(msg: LLMHistoryMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

/** Count images in an LLMHistoryMessage (multimodal content parts). */
function countImages(msg: LLMHistoryMessage): number {
  if (typeof msg.content === 'string') return 0;
  return msg.content.filter((p) => p.type === 'image_url').length;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export interface ContextUsageResult {
  tokenCount: TokenCount;
  needsCompact: boolean;
  compactMessages: (messages: ChatMessage[], strategyName: string) => ChatMessage[];
  rawContext: RawContextStats;
}

function mergeLiveChunks(messages: ChatMessage[], sessionId: string | null, streamingChunks: Record<string, string>, thinkingChunks: Record<string, string>, chunkSessionIds: Record<string, string>): ChatMessage[] {
  if (!sessionId) return messages;
  const nextMessages = [...messages];
  const indexById = new Map(nextMessages.map((message, index) => [message.id, index]));
  const chunkIds = new Set([...Object.keys(streamingChunks), ...Object.keys(thinkingChunks)]);

  chunkIds.forEach((messageId) => {
    if (chunkSessionIds[messageId] !== sessionId) return;
    const existingIndex = indexById.get(messageId);
    const content = streamingChunks[messageId];
    const thinking = thinkingChunks[messageId];

    if (existingIndex !== undefined) {
      const existing = nextMessages[existingIndex];
      nextMessages[existingIndex] = {
        ...existing,
        content: content ?? existing.content,
        thinking: thinking ?? existing.thinking,
      };
      return;
    }

    nextMessages.push({
      id: messageId,
      sessionId,
      role: 'assistant',
      content: content ?? '',
      thinking,
      streaming: true,
      createdAt: Date.now(),
    });
  });

  return nextMessages;
}

function buildContextSignature(messages: ChatMessage[], streamingChunks: Record<string, string>, thinkingChunks: Record<string, string>, chunkSessionIds: Record<string, string>): string {
  return JSON.stringify({
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      thinking: message.thinking,
      toolCalls: message.toolCalls,
      attachments: message.attachments?.map((attachment) => ({
        path: attachment.path,
        mimeType: attachment.mimeType,
      })),
    })),
    streamingChunks,
    thinkingChunks,
    chunkSessionIds,
  });
}

export function useContextUsage(): ContextUsageResult {
  const tools = useAgentStore((s) => s.tools);
  const getContextForSession = useAgentStore((s) => s.getContextForSession);
  const { activeSessionId, messages, streamingChunks, thinkingChunks, chunkSessionIds } = useSessionStore();
  const contextLimit = useSettingsStore((s) => s.getEffectiveContextWindow());
  const activeContext = getContextForSession(activeSessionId);
  const contextSignature = buildContextSignature(messages, streamingChunks, thinkingChunks, chunkSessionIds);

  const { tokenCount, rawContext } = useMemo(() => {
    // Build the same prompt parts that the backend uses
    const basePromptText = getCoreOsPrompt();

    const toolsText = tools.length > 0
      ? tools.map((t) => {
          const desc = t.description.length > 120
            ? t.description.slice(0, 119) + '…'
            : t.description;
          return `- ${t.name}: ${desc}`;
        }).join('\n')
      : '';

    const toolCallingPrompt = getToolCallingPrompt();
    const sessionNote = activeSessionId ? `\nCurrent session ID: ${activeSessionId}` : '';

    // Combine base + tool calling prompt + session note into "system prompt" category
    const fullBasePrompt = activeContext.systemPrompt ?? `${basePromptText}${toolCallingPrompt}${sessionNote}`;

    // Build history for token estimation
    const effectiveMessages = mergeLiveChunks(messages, activeSessionId, streamingChunks, thinkingChunks, chunkSessionIds);
    const history = buildHistory(effectiveMessages);
    const historyTexts: string[] = [];
    let imageCount = 0;

    for (const msg of history) {
      historyTexts.push(messageToText(msg));
      imageCount += countImages(msg);
    }

    const countInput: CountTokensInput = {
      systemPromptText: fullBasePrompt,
      skillsText: '',
      toolsText,
      historyTexts,
      imageCount,
      contextLimit,
      imageDetailMode: 'auto',
    };

    return {
      tokenCount: countTokens(countInput),
      rawContext: {
        contextLimit,
        systemPromptChars: fullBasePrompt.length,
        activeToolNames: activeContext.activeToolNames,
        history: effectiveMessages.map((message) => ({
          id: message.id,
          role: message.role,
          textChars: `${message.thinking ?? ''}${message.content}`.length,
          preview: message.content.length > 160 ? `${message.content.slice(0, 160)}...` : message.content,
        })),
        imageCount,
      },
    };
  }, [activeContext.activeToolNames, activeContext.systemPrompt, activeSessionId, contextLimit, contextSignature, messages, streamingChunks, thinkingChunks, chunkSessionIds, tools]);

  const needsCompact = tokenCount.total > contextLimit;

  const compactMessages = useCallback(
    (msgs: ChatMessage[], strategyName: string): ChatMessage[] => {
      const strategy = getCompactStrategy(strategyName);
      return strategy.compact(msgs, contextLimit);
    },
    [contextLimit],
  );

  return { tokenCount, needsCompact, compactMessages, rawContext };
}
