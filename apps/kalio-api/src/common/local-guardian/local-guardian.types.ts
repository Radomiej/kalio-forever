/** Advisory only: no result grants execution authority. */
export type LocalGuardianVerdict = 'allow' | 'deny' | 'ask_user';

export interface LocalGuardianInput {
  requestId: string;
  /** Trusted host policy; never populate from operation/model instructions. */
  policy: { id: string; instructions: string };
  /** Caller-owned, sanitized evidence; omit credentials and unrelated state. */
  context: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface LocalGuardianConfig {
  /** Full loopback /api/chat URL. No remote hosts or redirects. */
  endpoint: string;
  /** Exact Ollama tag, also required in the response envelope. */
  model: string;
  /** Default 8000; integer in [1, 30000]. */
  timeoutMs?: number;
}

export type LocalGuardianFallback = 'invalid_config' | 'invalid_request'
  | 'invalid_output' | 'provider_error' | 'timeout' | 'aborted';

export type LocalGuardianResult = {
  source: 'local-guardian';
  requestId: string;
  policyId: string;
} & (
  | { status: 'evaluated'; verdict: LocalGuardianVerdict; reason: string; model: string }
  | { status: 'fallback'; verdict: 'ask_user'; reason: LocalGuardianFallback }
);

/** Inject with a Nest useFactory provider; no module is registered here. */
export interface LocalGuardianTransport {
  post(endpoint: string, body: string, signal: AbortSignal): Promise<unknown>;
}
