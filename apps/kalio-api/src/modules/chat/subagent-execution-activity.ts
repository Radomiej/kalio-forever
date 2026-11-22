/** Observe current execution traffic, never status/budget heartbeats or provider timestamps. */
export function createSubagentActivityObserver(input: { sessionId: string; turnId: string; noteActivity: () => void }) {
  const seen = new Set<string>();
  const argumentSizes = new Map<string, number>();
  const mark = (key: string) => {
    if (seen.has(key)) return;
    if (seen.size >= 4096) seen.delete(seen.values().next().value!);
    seen.add(key); input.noteActivity();
  };
  return (event: string, data: unknown): void => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const read = (key: string): unknown => Object.getOwnPropertyDescriptor(data, key)?.value;
    const native = event === 'devin-cli-acp.tool';
    if (read(native ? 'kalioSessionId' : 'sessionId') !== input.sessionId
      || (read('turnId') !== undefined && read('turnId') !== input.turnId)) return;
    if (native) {
      const id = read('toolCallId'), status = read('toolStatus');
      if (read('turnId') !== input.turnId || typeof id !== 'string' || !id || id.length > 1024
        || typeof status !== 'string' || !['pending', 'in_progress', 'completed', 'failed'].includes(status)) return;
      mark(`native:${id}:${status}`); return;
    }
    if (event === 'chat:chunk' || event === 'cli_agent:progress') {
      const text = read(event === 'chat:chunk' ? 'delta' : 'chunk');
      if (typeof text === 'string' && text.length > 0) input.noteActivity();
      return;
    }
    const toolName = read('toolName');
    if (event === 'tool:arg_progress') {
      const total = read('totalChars');
      if (typeof toolName !== 'string' || !toolName || typeof total !== 'number' || !Number.isSafeInteger(total)
        || total <= (argumentSizes.get(toolName) ?? 0)) return;
      if (argumentSizes.size >= 64 && !argumentSizes.has(toolName)) argumentSizes.delete(argumentSizes.keys().next().value!);
      argumentSizes.set(toolName, total); input.noteActivity(); return;
    }
    if (event !== 'tool:start' && event !== 'tool:result') return;
    const id = read('callId');
    if (typeof id !== 'string' || !id || id.length > 1024) return;
    if (event === 'tool:result' && !['success', 'error', 'cancelled'].includes(String(read('status')))) return;
    // Retain identifiers only, never tool arguments or output.
    if (seen.has(`${event}:${id}`)) return;
    if (event === 'tool:start' && typeof toolName === 'string') argumentSizes.delete(toolName);
    mark(`${event}:${id}`);
  };
}
