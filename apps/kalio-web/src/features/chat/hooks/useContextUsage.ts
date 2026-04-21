/**
 * useContextUsage — memoized token counting + compact trigger for the chat.
 *
 * Reads from stores to estimate context usage without duplicating buildSystemPrompt.
 */
import { useMemo, useCallback } from 'react';
import type { ChatMessage } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { countTokens, type TokenCount, type CountTokensInput } from '../../../services/tokenCounter';
import { getCompactStrategy } from '../../../services/compactStrategy';
import { buildHistory } from '../buildHistory';
import type { LLMHistoryMessage } from '../buildHistory';
import { getToolCallingPrompt, getCoreOsPrompt } from '../../../services/modelPrompts';

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
}

export function useContextUsage(): ContextUsageResult {
  const tools = useAgentStore((s: any) => s.tools);
  const { activeSessionId, sessions } = useSessionStore();
  const { llm } = useSettingsStore();

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const messages = activeSession?.messages ?? [];
  const contextLimit = llm.contextWindowSize ?? 32000;

  const tokenCount = useMemo(() => {
    // Build the same prompt parts that the backend uses
    const basePromptText = getCoreOsPrompt(llm.primaryModel?.model);

    const toolsText = tools.length > 0
      ? tools.map((t: any) => {
          const desc = t.description.length > 120
            ? t.description.slice(0, 119) + '…'
            : t.description;
          return `- ${t.name}: ${desc}`;
        }).join('\n')
      : '';

    const toolCallingPrompt = getToolCallingPrompt(llm.primaryModel?.model);
    const sessionNote = activeSessionId ? `\nCurrent session ID: ${activeSessionId}` : '';

    // Combine base + tool calling prompt + session note into "system prompt" category
    const fullBasePrompt = `${basePromptText}${toolCallingPrompt}${sessionNote}`;

    // Build history for token estimation
    const history = buildHistory(messages);
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
      imageDetailMode: llm.imageDetailMode ?? 'auto',
    };

    return countTokens(countInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, tools.length, llm.primaryModel, activeSessionId, contextLimit]);

  const needsCompact = tokenCount.total > contextLimit;

  const compactMessages = useCallback(
    (msgs: ChatMessage[], strategyName: string): ChatMessage[] => {
      const strategy = getCompactStrategy(strategyName);
      return strategy.compact(msgs, contextLimit);
    },
    [contextLimit],
  );

  return { tokenCount, needsCompact, compactMessages };
}
