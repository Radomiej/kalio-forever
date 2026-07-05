import type { ArchitectureChatRunSummary } from '@kalio/types';

type TraceSpeaker = ArchitectureChatRunSummary['trace'][number]['speaker'];
type TraceStreamStatus = NonNullable<ArchitectureChatRunSummary['trace'][number]['stream']>['status'];
type TraceLifecycleStatus = ArchitectureChatRunSummary['trace'][number]['status'] | 'completed' | 'pending' | 'waiting';

export function architectureTraceActivitySummary(
  speaker: TraceSpeaker,
  streamStatus?: TraceStreamStatus,
  status?: TraceLifecycleStatus,
): string {
  if (speaker === 'router') {
    if (status === 'cancelled') {
      return 'Router was cancelled before selecting the next graph node.';
    }
    if (status === 'failed' || streamStatus === 'failed') {
      return 'Router failed to synthesize the next graph node.';
    }
    if (streamStatus === 'started' || streamStatus === 'streaming') {
      return 'Router is synthesizing the next graph node.';
    }
    return 'Router completed synthesis for the next graph node.';
  }

  if (speaker === 'finalizer') {
    if (status === 'cancelled') {
      return 'Finalizer was cancelled before producing the final answer.';
    }
    if (status === 'failed' || streamStatus === 'failed') {
      return 'Finalizer failed to produce the final answer.';
    }
    if (streamStatus === 'started' || streamStatus === 'streaming') {
      return 'Finalizer is producing the final answer.';
    }
    return 'Final answer produced from the routed graph outputs.';
  }

  if (status === 'cancelled') {
    return 'Branch was cancelled before producing its role-specific response.';
  }
  if (status === 'failed' || streamStatus === 'failed') {
    return 'Branch failed to produce its role-specific response.';
  }
  if (streamStatus === 'started' || streamStatus === 'streaming') {
    return 'Branch is producing its role-specific response.';
  }
  return 'Branch completed its role-specific response.';
}

export function compactArchitectureTraceContent(content: string | null | undefined, speaker: TraceSpeaker): string {
  const cleaned = stripArchitectureRuntimeScaffold(content);
  if (cleaned) {
    return cleaned;
  }
  return architectureTraceActivitySummary(speaker);
}

export function stripArchitectureRuntimeScaffold(content: string | null | undefined): string {
  const source = typeof content === 'string' ? content : '';
  const normalized = source
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
