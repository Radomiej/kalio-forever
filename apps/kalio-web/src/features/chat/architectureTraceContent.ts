import type { ArchitectureChatRunSummary } from '@kalio/types';

type TraceSpeaker = ArchitectureChatRunSummary['trace'][number]['speaker'];

export function compactArchitectureTraceContent(content: string, speaker: TraceSpeaker): string {
  const cleaned = stripArchitectureRuntimeScaffold(content);
  if (cleaned) {
    return cleaned;
  }
  if (speaker === 'router') {
    return 'Router completed synthesis for the next graph node.';
  }
  if (speaker === 'finalizer') {
    return 'Final answer produced from the routed graph outputs.';
  }
  return 'Branch completed its role-specific response.';
}

export function stripArchitectureRuntimeScaffold(content: string): string {
  const normalized = content
    .replace(/^\[MockLLM\]\s*Echo:\s*/i, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, ' ')
    .replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const kept: string[] = [];
  let skippingIncoming = false;
  let skipNextAvailableNodeLine = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (kept.length > 0 && kept.at(-1) !== '') {
        kept.push('');
      }
      continue;
    }

    if (/^Incoming graph outputs:?$/i.test(line)) {
      skippingIncoming = true;
      continue;
    }
    if (/^Available next nodes:/i.test(line)) {
      skippingIncoming = false;
      skipNextAvailableNodeLine = true;
      continue;
    }
    if (skipNextAvailableNodeLine) {
      skipNextAvailableNodeLine = false;
      continue;
    }
    if (skippingIncoming || isRuntimeScaffoldLine(line)) {
      continue;
    }
    kept.push(rawLine.trimEnd());
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isRuntimeScaffoldLine(line: string): boolean {
  return /^Architecture:/i.test(line)
    || /^Slot:/i.test(line)
    || /^Node:/i.test(line)
    || /^Task:/i.test(line)
    || /^-\s*[-\w]+:\s+\[MockLLM\]/i.test(line)
    || /^[-\w]+:\s+.*(?:started|completed|agent started|\[MockLLM\])/i.test(line)
    || /^Return a concise role-specific contribution/i.test(line)
    || /^Act as a graph router\./i.test(line)
    || /^Produce the final user-facing answer/i.test(line);
}
