import { describe, expect, it } from 'vitest';
import { escapeMarkdownV2, splitMessage } from './telegram.utils';

describe('telegram.utils', () => {
  it('escapes Telegram MarkdownV2 control characters', () => {
    expect(escapeMarkdownV2('_*[]()~`>#+=|{}.!-')).toBe('\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\=\\|\\{\\}\\.\\!\\-');
  });

  it('returns a single chunk when the text already fits', () => {
    expect(splitMessage('short', 10)).toStrictEqual(['short']);
  });

  it('splits long messages on line boundaries when possible', () => {
    expect(splitMessage('aa\nbb\ncc', 5)).toStrictEqual(['aa\nbb', 'cc']);
  });
});