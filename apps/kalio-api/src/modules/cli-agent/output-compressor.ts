/** Approximate chars-per-token for cl100k_base (GPT-3.5/4, Copilot). */
const CHARS_PER_TOKEN = 4;

/**
 * Trims CLI output to fit within maxChars before it is stored in the
 * LLM conversation history. Keeps the tail (most recent output) as it is
 * more relevant than the beginning.
 *
 * @param output     Raw combined stdout+stderr from the subprocess.
 * @param maxChars   Character budget. Defaults to 16 000 (~4 000 tokens).
 * @returns          Possibly truncated string with a header note if trimmed.
 */
export function compressOutput(output: string, maxChars = 16_000): string {
  if (!output) return '';
  if (output.length <= maxChars) return output;

  const kept = output.slice(-maxChars);
  const dropped = output.length - maxChars;
  const droppedTokens = Math.round(dropped / CHARS_PER_TOKEN);
  const header = `[output truncated — ${dropped} chars (~${droppedTokens} tokens) omitted from beginning]\n`;
  return header + kept;
}
