/**
 * Escape special MarkdownV2 characters outside code spans.
 * Required by Telegram's MarkdownV2 parse mode.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[-_*[\]()~`>#+=|{}.!]/g, (c) => `\\${c}`);
}

/**
 * Split a long message into chunks of at most maxLen characters,
 * preferring to break at newlines.
 */
export function splitMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
