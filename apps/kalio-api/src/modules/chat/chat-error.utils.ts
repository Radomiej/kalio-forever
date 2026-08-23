type ChatErrorCode = import('@kalio/types').SocketEvents['chat:error']['code'];

export function getChatErrorCode(err: unknown): ChatErrorCode {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (
      code === 'LLM_RATE_LIMIT' ||
      code === 'LLM_TIMEOUT' ||
      code === 'LLM_AUTH' ||
      code === 'LLM_PROVIDER_DOWN' ||
      code === 'LLM_QUOTA' ||
      code === 'LLM_BAD_TOOL_ARGS' ||
      code === 'LLM_BAD_STRUCTURED_OUTPUT' ||
      code === 'MAX_ITERATIONS_REACHED'
    ) {
      return code;
    }
  }
  return 'LLM_ERROR';
}
