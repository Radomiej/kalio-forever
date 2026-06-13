import type { SubagentToolResult } from '@kalio/types';

export function parseSubagentToolResult(content: string): SubagentToolResult | null {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate['result'] !== 'string'
      || typeof candidate['taskId'] !== 'string'
      || typeof candidate['childSessionId'] !== 'string'
      || typeof candidate['parentSessionId'] !== 'string'
      || (candidate['vfsMode'] !== 'shared' && candidate['vfsMode'] !== 'isolated')
      || typeof candidate['vfsSessionId'] !== 'string'
      || !Array.isArray(candidate['copiedFiles'])
      || typeof candidate['durationMs'] !== 'number'
    ) {
      return null;
    }
    return candidate as unknown as SubagentToolResult;
  } catch {
    return null;
  }
}
