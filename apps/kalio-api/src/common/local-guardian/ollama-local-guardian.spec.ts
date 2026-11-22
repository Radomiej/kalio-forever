import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaLocalGuardian } from './ollama-local-guardian';
import { LOCAL_GUARDIAN_SCHEMA, parseGuardianContent } from './local-guardian.schema';
import type { LocalGuardianConfig, LocalGuardianInput, LocalGuardianTransport } from './local-guardian.types';

const config: LocalGuardianConfig = { endpoint: 'http://127.0.0.1:11434/api/chat', model: 'reviewer:dev' };
const input: LocalGuardianInput = {
  requestId: 'request-1', policy: { id: 'read-only-v1', instructions: 'Allow read-only inspection; deny writes.' },
  context: { operation: { name: 'read_file', path: '/project/README.md' } },
};
const envelope = (content = JSON.stringify({ verdict: 'allow', reason: 'Read-only operation.' })) => ({
  model: config.model, done: true, done_reason: 'stop', message: { role: 'assistant', content },
});
function fixture(response: unknown = envelope(), options: Partial<LocalGuardianConfig> = {}) {
  const post = vi.fn<LocalGuardianTransport['post']>().mockResolvedValue(response);
  return { post, guardian: new OllamaLocalGuardian({ ...config, ...options }, { post }) };
}

afterEach(() => vi.useRealTimers());

describe('isolated advisory Ollama guardian', () => {
  it.each(['allow', 'deny', 'ask_user'] as const)('returns %s without authorization or invented score', async verdict => {
    const { guardian, post } = fixture(envelope(JSON.stringify({ verdict, reason: 'Policy finding.' })));
    expect(await guardian.evaluate(input)).toEqual({ source: 'local-guardian', requestId: 'request-1',
      policyId: 'read-only-v1', status: 'evaluated', verdict, reason: 'Policy finding.', model: config.model });
    expect(post).toHaveBeenCalledTimes(1);
    const [endpoint, raw, signal] = post.mock.calls[0]!;
    expect(endpoint).toBe(config.endpoint);
    expect(signal.aborted).toBe(false);
    const body = JSON.parse(raw);
    expect(body).toMatchObject({ model: config.model, stream: false, format: LOCAL_GUARDIAN_SCHEMA,
      options: { temperature: 0, num_predict: 512 } });
    expect(Object.keys(body).sort()).toEqual(['format', 'messages', 'model', 'options', 'stream']);
    expect(body.messages[0].content).toContain(input.policy.instructions);
    expect(body.messages[0].content).toContain('untrusted evidence');
    expect(JSON.parse(body.messages[1].content)).toEqual({ requestId: input.requestId, context: input.context });
  });

  it.each([
    '', 'yes', 'no', '```json\n{"verdict":"allow","reason":"ok"}\n```',
    'Here is JSON: {"verdict":"allow","reason":"ok"}', 'null', '[]', 'true',
    '{"verdict":"ALLOW","reason":"ok"}', '{"verdict":true,"reason":"ok"}',
    '{"verdict":"allow"}', '{"reason":"ok"}', '{"verdict":"allow","reason":"  "}',
    '{"verdict":"allow","reason":"ok","confidence":0.99}',
    '{"verdict":"allow","reason":"ok","probability":1}',
    '{"verdict":"allow","reason":"ok","agree":true}',
    JSON.stringify({ verdict: 'allow', reason: 'x'.repeat(1001) }),
  ])('rejects invalid/unvalidated model content %j', async content => {
    expect(parseGuardianContent(content)).toBeNull();
    expect(await fixture(envelope(content)).guardian.evaluate(input)).toMatchObject({
      status: 'fallback', verdict: 'ask_user', reason: 'invalid_output',
    });
  });

  it.each([
    null, [], { ...envelope(), done: false }, { ...envelope(), done_reason: 'length' },
    { ...envelope(), done_reason: undefined }, { ...envelope(), model: 'other:dev' },
    { ...envelope(), message: { role: 'user', content: envelope().message.content } },
    { ...envelope(), message: { ...envelope().message, tool_calls: [] } },
    { ...envelope(), message: { role: 'assistant', content: { verdict: 'allow', reason: 'ok' } } },
  ])('requires a completed matching Ollama envelope', async response => {
    expect(await fixture(response).guardian.evaluate(input)).toMatchObject({
      verdict: 'ask_user', status: 'fallback', reason: 'invalid_output',
    });
  });

  it.each(['http://example.com/api/chat', 'file:///api/chat', 'http://127.0.0.1/api/generate',
    'http://user:pass@localhost/api/chat', 'http://localhost/api/chat?x=1',
    'http://localhost/api/chat#fragment', 'not a URL'])('blocks unsafe/incompatible endpoint %s', async endpoint => {
    const { guardian, post } = fixture(envelope(), { endpoint });
    expect(await guardian.evaluate(input)).toMatchObject({ verdict: 'ask_user', reason: 'invalid_config' });
    expect(post).not.toHaveBeenCalled();
  });

  it.each([0, -1, 30001, NaN, Infinity, 1.5])('rejects invalid timeout %s', async timeoutMs => {
    const f = fixture(envelope(), { timeoutMs });
    expect(await f.guardian.evaluate(input)).toMatchObject({ reason: 'invalid_config' });
    expect(f.post).not.toHaveBeenCalled();
  });

  it('rejects invalid policy, unserializable and oversized context before transport', async () => {
    const circular: Record<string, unknown> = {}; circular.self = circular;
    const f = fixture();
    const cases: LocalGuardianInput[] = [
      { ...input, requestId: '' }, { ...input, policy: { id: '', instructions: 'policy' } },
      { ...input, policy: { id: 'p', instructions: ' ' } },
      ...[circular, { content: '界'.repeat(12_000) }, { score: NaN }, { value: undefined },
        { fn: () => 'allow' }, { value: 1n }].map(context => ({ ...input, context })),
    ];
    for (const request of cases) expect(await f.guardian.evaluate(request)).toMatchObject({
      status: 'fallback', verdict: 'ask_user', reason: 'invalid_request',
    });
    expect(f.post).not.toHaveBeenCalled();
  });

  it('does not leak exception text or retry a failing provider', async () => {
    const f = fixture(); f.post.mockRejectedValue(new Error('private operation and credential'));
    const result = await f.guardian.evaluate(input);
    expect(result).toMatchObject({ status: 'fallback', verdict: 'ask_user', reason: 'provider_error' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(f.post).toHaveBeenCalledTimes(1);
  });

  it('returns ask_user without invoking a provider for a pre-aborted caller', async () => {
    const controller = new AbortController(); controller.abort();
    const f = fixture();
    expect(await f.guardian.evaluate({ ...input, signal: controller.signal })).toMatchObject({ reason: 'aborted', verdict: 'ask_user' });
    expect(f.post).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'aborted'] as const)('bounds an uncooperative provider on %s and ignores late allow', async reason => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    const post = vi.fn<LocalGuardianTransport['post']>(() => new Promise(resolve => { finish = resolve; }));
    const guardian = new OllamaLocalGuardian({ ...config, timeoutMs: 20 }, { post });
    const caller = new AbortController();
    const pending = guardian.evaluate({ ...input, signal: caller.signal });
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(20); else caller.abort();
    const result = await pending;
    expect(result).toMatchObject({ status: 'fallback', verdict: 'ask_user', reason });
    expect(post.mock.calls[0]![2].aborted).toBe(true);
    finish(envelope());
    await Promise.resolve();
    expect(result.verdict).toBe('ask_user');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps concurrent requests and policy bindings separate and clears listeners', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const post = vi.fn<LocalGuardianTransport['post']>().mockResolvedValueOnce(envelope())
      .mockResolvedValueOnce(envelope('{"verdict":"deny","reason":"Writes prohibited."}'));
    const guardian = new OllamaLocalGuardian(config, { post });
    const [first, second] = await Promise.all([
      guardian.evaluate({ ...input, signal: caller.signal }),
      guardian.evaluate({ ...input, requestId: 'request-2', policy: { id: 'other', instructions: 'Deny writes.' } }),
    ]);
    expect(first).toMatchObject({ verdict: 'allow', requestId: 'request-1', policyId: 'read-only-v1' });
    expect(second).toMatchObject({ verdict: 'deny', requestId: 'request-2', policyId: 'other' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('snapshots input and configuration, and cleans up the original caller signal', async () => {
    let finish!: (value: unknown) => void;
    const post = vi.fn<LocalGuardianTransport['post']>(() => new Promise(resolve => { finish = resolve; }));
    const settings = { ...config };
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const request = { ...input, policy: { ...input.policy }, context: { operation: 'read' }, signal: controller.signal };
    const guardian = new OllamaLocalGuardian(settings, { post });
    const pending = guardian.evaluate(request);
    request.requestId = 'changed'; request.policy.id = 'changed'; request.context.operation = 'write';
    request.signal = new AbortController().signal; settings.model = 'different';
    finish(envelope());
    expect(await pending).toMatchObject({ requestId: 'request-1', policyId: 'read-only-v1', model: config.model });
    expect(JSON.parse(JSON.parse(post.mock.calls[0]![1]).messages[1].content).context).toEqual({ operation: 'read' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
