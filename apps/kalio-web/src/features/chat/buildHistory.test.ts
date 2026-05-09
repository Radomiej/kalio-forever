import { describe, expect, it } from 'vitest';
import { buildHistory, type ContentPart } from './buildHistory';
import type { ChatMessage } from '@kalio/types';

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: '',
    createdAt: 1,
    ...overrides,
  };
}

function getParts(message: ReturnType<typeof buildHistory>[number]): ContentPart[] {
  expect(Array.isArray(message.content)).toBe(true);
  return message.content as ContentPart[];
}

describe('buildHistory attachments and multimodal options (REGRESSION)', () => {
  it('keeps image-only user messages in history instead of dropping them', () => {
    const history = buildHistory([
      makeMessage({
        attachments: [{ path: 'uploads/cat.png', mimeType: 'image/png' }],
      }),
    ]);

    expect(history).toHaveLength(1);
    expect(history[0]?.role).toBe('user');
    expect(getParts(history[0]).filter((part) => part.type === 'image_url')).toHaveLength(1);
  });

  it('builds multimodal content for text plus attachment messages', () => {
    const history = buildHistory([
      makeMessage({
        content: 'Look at this image',
        attachments: [{ path: 'uploads/cat.png', mimeType: 'image/png' }],
      }),
    ]);

    expect(history).toHaveLength(1);
    const parts = getParts(history[0]);
    expect(parts[0]).toEqual({ type: 'text', text: 'Look at this image' });
    expect(parts.filter((part) => part.type === 'image_url')).toHaveLength(1);
  });

  it('preserves all attached images instead of collapsing them away', () => {
    const history = buildHistory([
      makeMessage({
        content: 'Two images',
        attachments: [
          { path: 'uploads/first.png', mimeType: 'image/png' },
          { path: 'uploads/second.png', mimeType: 'image/png' },
        ],
      }),
    ]);

    expect(history).toHaveLength(1);
    expect(getParts(history[0]).filter((part) => part.type === 'image_url')).toHaveLength(2);
  });

  it('propagates imageDetailMode to image parts', () => {
    const history = buildHistory([
      makeMessage({
        content: 'Low detail please',
        attachments: [{ path: 'uploads/cat.png', mimeType: 'image/png' }],
      }),
    ], { imageDetailMode: 'low' });

    const imagePart = getParts(history[0]).find((part) => part.type === 'image_url');
    expect(imagePart).toBeDefined();
    expect(imagePart).toMatchObject({
      type: 'image_url',
      image_url: { detail: 'low' },
    });
  });
});