import type { ToolCallContent } from '@agentclientprotocol/sdk';

export function summarizeDevinToolOutput(status: string | null | undefined, output: unknown, content?: ToolCallContent[] | null) {
  const text: string[] = [];
  if (typeof output === 'string') text.push(output);
  else if (isRecord(output)) {
    if (typeof output['message'] === 'string') text.push(output['message']);
    const error = output['error'];
    if (typeof error === 'string') text.push(error);
    else if (isRecord(error) && typeof error['message'] === 'string') text.push(error['message']);
  }
  for (const item of content ?? []) {
    if (item.type === 'content' && item.content.type === 'text') text.push(item.content.text);
  }
  // This is an observed keyword, not proof of a particular policy decision.
  // Persist only booleans: never tool output, paths, file diffs or credentials.
  return {
    outputPresent: output !== undefined && output !== null || (content?.length ?? 0) > 0,
    permissionMentionedInFailure: status === 'failed'
      && text.some(value => /\bpermissions?\b|\bdenied\b|\bnot allowed\b/i.test(value.slice(0, 4096))),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
