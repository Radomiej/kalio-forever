import type { ChatMessage } from '@kalio/types';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export type LLMHistoryMessage = {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
};

export interface BuildHistoryOptions {
  /** When true, replace image_url parts with text placeholders (for non-vision models). */
  stripImages?: boolean;
  /** OpenAI-compatible detail level for image_url parts. Default: 'auto' */
  imageDetailMode?: 'low' | 'auto' | 'high';
}

function isImageAttachment(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

function buildUserContentParts(message: ChatMessage, options: BuildHistoryOptions): ContentPart[] {
  const imageDetailMode = options.imageDetailMode ?? 'auto';
  const imageAttachments = (message.attachments ?? []).filter((attachment) => isImageAttachment(attachment.mimeType));
  const parts: ContentPart[] = [];

  if (message.content.length > 0) {
    parts.push({ type: 'text', text: message.content });
  }

  if (options.stripImages) {
    parts.push(
      ...imageAttachments.map((attachment) => ({
        type: 'text' as const,
        text: `[Image attachment: ${attachment.path}]`,
      })),
    );
    return parts;
  }

  parts.push(
    ...imageAttachments.map((attachment) => ({
      type: 'image_url' as const,
      image_url: {
        url: attachment.path,
        detail: imageDetailMode,
      },
    })),
  );

  return parts;
}

/**
 * Converts session messages into LLM-compatible history.
 * - user/assistant text messages → passed through
 * - loading messages → skipped
 */
export function buildHistory(messages: ChatMessage[], options: BuildHistoryOptions = {}): LLMHistoryMessage[] {
  const out: LLMHistoryMessage[] = [];

  for (const m of messages) {
    if (m.role === 'user') {
      const parts = buildUserContentParts(m, options);
      if (parts.length > 0) {
        out.push({ role: 'user', content: parts.length === 1 && parts[0]?.type === 'text' ? parts[0].text : parts });
        continue;
      }

      if (m.content?.trim()) {
        out.push({ role: 'user', content: m.content });
      }
      continue;
    }

    if (m.role === 'assistant' && m.content?.trim()) {
      out.push({ role: 'assistant', content: m.content });
      continue;
    }
  }

  return out;
}
