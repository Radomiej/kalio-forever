import type { ChatMessage, SessionRuntimeContext } from '@kalio/types';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';

const MAX_TITLE_LENGTH = 60;
const TITLE_SYSTEM_PROMPT = [
  'Generate a concise conversation title.',
  'Summarize the real user goal instead of copying the prompt.',
  'Return plain title text only.',
  'Use 2 to 6 words when possible.',
  `Never exceed ${MAX_TITLE_LENGTH} characters.`,
  'No quotes, markdown, or trailing punctuation.',
].join(' ');
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'do', 'for', 'from', 'if', 'in', 'into', 'is', 'it', 'its', 'of', 'ok',
  'on', 'or', 'out', 'reply', 'that', 'the', 'this', 'to', 'use', 'with', 'without', 'you',
  'ale', 'bo', 'co', 'czy', 'dla', 'do', 'i', 'jak', 'na', 'nie', 'oraz', 'po', 'to', 'użyj', 'uzyj', 'w',
  'we', 'z',
]);

export function buildTitlePrompt(history: ChatMessage[]): ContextManagedLLMMessage[] {
  const userPrompt = normalizedUserPrompt(history);
  const latestAssistant = [...history]
    .reverse()
    .find((message) => message.role === 'assistant' && normalizeConversationLine(message.content).length > 0);

  return [
    { role: 'system', content: TITLE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        firstUserMessage: userPrompt,
        latestAssistantMessage: latestAssistant ? normalizeConversationLine(latestAssistant.content).slice(0, 600) : null,
      }),
    },
  ];
}

export function normalizeGeneratedTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!,:;\-–—]+$/u, '')
    .trim();
  if (normalized.length === 0) return null;
  const bounded = normalized.length > MAX_TITLE_LENGTH
    ? normalized.slice(0, MAX_TITLE_LENGTH).trimEnd()
    : normalized;
  return bounded.length > 0 ? bounded : null;
}

export function deriveFallbackTitle(
  history: ChatMessage[],
  runtimeContext: SessionRuntimeContext | null | undefined,
  defaultTitle: string,
): string {
  const firstUser = normalizedUserPrompt(history);
  if (!firstUser) return defaultTitle;

  const projectName = projectNameFromRuntimeContext(runtimeContext);
  if (/(architektur|architecture)/iu.test(firstUser)) {
    const architectureTitle = projectName ? `Architecture Review ${projectName}` : 'Architecture Review';
    return normalizeGeneratedTitle(architectureTitle) ?? defaultTitle;
  }

  const firstSentence = firstUser.split(/[.!?]/u).find((segment) => segment.trim().length > 0)?.trim() ?? firstUser;
  const titleTokens = (firstSentence.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [])
    .filter((token) => token.length > 1)
    .filter((token) => !TITLE_STOPWORDS.has(token.toLowerCase()))
    .slice(0, 4);
  if (titleTokens.length > 0) {
    const candidate = titleTokens.map(titleTokenCase).join(' ');
    return normalizeGeneratedTitle(candidate) ?? defaultTitle;
  }
  return normalizeGeneratedTitle(firstSentence) ?? defaultTitle;
}

export function normalizedUserPrompt(history: ChatMessage[]): string {
  const firstUser = history.find((message) => message.role === 'user');
  return firstUser ? stripArchitecturePrefix(normalizeConversationLine(firstUser.content)) : '';
}

function normalizeConversationLine(content: unknown): string {
  return typeof content === 'string' ? content.replace(/\s+/g, ' ').trim() : '';
}

function stripArchitecturePrefix(content: string): string {
  return content.replace(/^\[Architecture:\s*[^\]]+\]\s*/i, '').trim();
}

function projectNameFromRuntimeContext(runtimeContext: SessionRuntimeContext | null | undefined): string | null {
  const projectPath = runtimeContext?.architectureContext?.['projectPath'];
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) return null;
  const normalized = projectPath.trim().replaceAll('\\', '/').split('/').filter(Boolean);
  return normalized.at(-1) ?? null;
}

function titleTokenCase(token: string): string {
  if (token.toUpperCase() === token) return token;
  return `${token[0]?.toUpperCase() ?? ''}${token.slice(1).toLowerCase()}`;
}
