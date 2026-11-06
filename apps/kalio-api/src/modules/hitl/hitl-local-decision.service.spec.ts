import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisionSettingsPort } from '@kalio/types';
import type { LocalGuardianTransport } from '../../common/local-guardian/local-guardian.types';
import { HitlLocalDecisionService } from './hitl-local-decision.service';
import type { HitlApprovalRequest } from './hitl.types';

const endpoint = 'http://127.0.0.1:11434/api/chat';
const config = { provider: 'ollama', model: 'fixture:1', credentialId: null, endpoint };
const envelope = (verdict: string) => ({ model: 'fixture:1', done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ verdict, reason: 'fixture reason' }) } });
function setup() {
  const decisions = { getConfig: vi.fn().mockResolvedValue(config), resolve: vi.fn().mockResolvedValue({ protocol: 'ollama-chat', endpoint, model: 'fixture:1', revision: 0 }) };
  const transport = { post: vi.fn<LocalGuardianTransport['post']>().mockResolvedValue(envelope('allow')) };
  const service = new HitlLocalDecisionService(decisions as unknown as DecisionSettingsPort, transport);
  const request: HitlApprovalRequest = { kind: 'tool', sessionId: 's', toolCallId: 't', name: 'fs_read', args: { path: '/project/readme.md' } };
  return { decisions, transport, service, request };
}
describe('native HITL local model boundary', () => {
  beforeEach(() => { vi.stubEnv('KALIO_DEV_LOCAL_DECISIONS', 'true'); vi.stubEnv('KALIO_LOCAL_DECISION_TIMEOUT_MS', '8000'); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  it.each(['allow', 'deny', 'ask_user'])('returns explicit %s with validated reason and model, without scores', async verdict => {
    const { service, transport, decisions, request } = setup();
    transport.post.mockResolvedValue(envelope(verdict));
    const result = await service.evaluateApproval(request);
    expect(result).toEqual({ status: 'evaluated', verdict, model: 'fixture:1', reason: 'fixture reason' });
    expect(decisions.resolve).toHaveBeenCalledWith('tools');
    const body = JSON.parse(transport.post.mock.calls[0]![1] as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('questions');
    expect(body).toHaveProperty('stream', false);
    expect(body).toHaveProperty('think', false);
    expect(body).toHaveProperty('truncate', false);
    expect(body).toHaveProperty('shift', false);
    expect(body).toHaveProperty('options', { temperature: 0, num_predict: 512, num_ctx: 8192, num_gpu: 0 });
    expect(result).not.toHaveProperty('confidence');
    service.discard(result);
  });
  it('does no inference with the host gate disabled', async () => {
    vi.stubEnv('KALIO_DEV_LOCAL_DECISIONS', 'false');
    const { service, transport, request } = setup();
    expect(await service.evaluateApproval(request)).toMatchObject({ status: 'fallback', verdict: 'ask_user' });
    expect(transport.post).not.toHaveBeenCalled();
  });
  it.each(['terminal_exec', 'fs_write', 'unknown'])('never evaluates protected tool %s', async name => {
    const { service, transport, request } = setup();
    expect(await service.evaluateApproval({ ...request, name })).toHaveProperty('reason', 'invalid_request');
    expect(transport.post).not.toHaveBeenCalled();
  });
  it.each(['raapp_native', 'external_security'] as const)('does not evaluate %s', async kind => {
    const { service, transport, request } = setup();
    await service.evaluateApproval({ ...request, kind });
    expect(transport.post).not.toHaveBeenCalled();
  });
  it('does not send redacted or truncated evidence', async () => {
    const { service, transport, request } = setup();
    request.args = { token: 'private' };
    expect(await service.evaluateApproval(request)).toHaveProperty('reason', 'invalid_request');
    expect(transport.post).not.toHaveBeenCalled();
  });
  it('rejects a full UTF-8 request over the context budget without network', async () => {
    const { service, transport, request } = setup();
    request.args = { paths: ['ą'.repeat(1500), '漢'.repeat(1500)] };
    expect(await service.evaluateApproval(request)).toHaveProperty('reason', 'invalid_request');
    expect(transport.post).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '120001', 'NaN', '1.5'])('rejects invalid host timeout %s without network', async timeout => {
    vi.stubEnv('KALIO_LOCAL_DECISION_TIMEOUT_MS', timeout);
    const { service, transport, request } = setup();
    expect(await service.evaluateApproval(request)).toHaveProperty('reason', 'unavailable');
    expect(transport.post).not.toHaveBeenCalled();
  });
  it('honors a bounded longer host timeout for cold starts', async () => {
    vi.useFakeTimers();
    vi.stubEnv('KALIO_LOCAL_DECISION_TIMEOUT_MS', '20000');
    const { service, transport, request } = setup();
    transport.post.mockImplementation(() => new Promise(() => undefined));
    const pending = service.evaluateApproval(request);
    await vi.advanceTimersByTimeAsync(8001);
    expect(transport.post.mock.calls[0]![2].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await pending).toMatchObject({ status: 'fallback', verdict: 'ask_user' });
  });
  it.each([{}, { ...envelope('allow'), done_reason: 'length' }, envelope('unknown'), { ...envelope('allow'), model: 'other' }])('fails closed for invalid output', async output => {
    const { service, transport, request } = setup();
    transport.post.mockResolvedValue(output as ReturnType<typeof envelope>);
    expect(await service.evaluateApproval(request)).toMatchObject({ status: 'fallback', verdict: 'ask_user' });
  });
  it('does not leak provider exceptions', async () => {
    const { service, transport, request } = setup();
    transport.post.mockRejectedValue(new Error('private payload'));
    expect(await service.evaluateApproval(request)).toEqual({ status: 'fallback', verdict: 'ask_user', reason: 'unavailable' });
  });
  it('does not retry without think:false when a model rejects the control', async () => {
    const { service, transport, request } = setup();
    transport.post.mockRejectedValue(new Error('Unsupported thinking control'));
    expect(await service.evaluateApproval(request)).toMatchObject({ status: 'fallback', verdict: 'ask_user' });
    expect(transport.post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(transport.post.mock.calls[0]![1])).toHaveProperty('think', false);
  });
  it('rejects reasoning output when non-thinking was explicitly requested', async () => {
    const { service, transport, request } = setup();
    const response = envelope('allow');
    transport.post.mockResolvedValue({ ...response, message: { ...response.message, thinking: 'unexpected reasoning' } });
    expect(await service.evaluateApproval(request)).toHaveProperty('reason', 'invalid_output');
  });
  it('propagates caller cancellation even when transport ignores it', async () => {
    const { service, transport, request } = setup();
    const controller = new AbortController();
    transport.post.mockImplementation(async () => { controller.abort(new Error('stop')); return envelope('allow'); });
    await expect(service.evaluateApproval({ ...request, abortSignal: controller.signal })).rejects.toThrow('stop');
  });
  it('bounds an unresponsive transport without retries', async () => {
    vi.useFakeTimers();
    const { service, transport, request } = setup();
    transport.post.mockImplementation(() => new Promise(() => undefined));
    const pending = service.evaluateApproval(request);
    await vi.advanceTimersByTimeAsync(8001);
    expect(await pending).toMatchObject({ status: 'fallback', verdict: 'ask_user' });
    expect(transport.post).toHaveBeenCalledTimes(1);
  });
  it('invalidates an allow after request mutation', async () => {
    const { service, transport, request } = setup();
    transport.post.mockImplementation(async () => { request.args.path = '/other'; return envelope('allow'); });
    expect(await service.evaluateApproval(request)).toHaveProperty('reason', 'stale');
  });
  it('invalidates settings A-B-A through the host revision', async () => {
    const { service, decisions, request } = setup();
    decisions.resolve.mockResolvedValueOnce({ protocol: 'ollama-chat', endpoint, model: 'fixture:1', revision: 0 })
      .mockResolvedValueOnce({ protocol: 'ollama-chat', endpoint, model: 'fixture:1', revision: 2 });
    expect(await service.evaluateApproval(request)).toHaveProperty('reason', 'stale');
  });
  it('rejects changed settings even when model response is valid', async () => {
    const { service, decisions, request } = setup();
    decisions.getConfig.mockResolvedValueOnce(config).mockResolvedValueOnce({ ...config, model: 'changed' });
    expect(await service.evaluateApproval(request)).toHaveProperty('reason', 'stale');
  });
  it('revalidates a returned verdict before policy consumption', async () => {
    const { service, decisions, request } = setup();
    const result = await service.evaluateApproval(request);
    decisions.resolve.mockResolvedValue({ protocol: 'ollama-chat', endpoint, model: 'fixture:1', revision: 4 });
    expect(await service.consume(result)).toBe(false);
  });
  it('rejects fabricated results that were not produced by this evaluator', async () => {
    const { service } = setup();
    expect(await service.consume({ status: 'evaluated', verdict: 'allow', model: 'fixture:1', reason: 'fabricated reason' })).toBe(false);
  });
  it.each(['', '   ', 'x'.repeat(1001)])('does not propagate an invalid model reason', async reason => {
    const { service, transport, request } = setup();
    const response = envelope('allow');
    transport.post.mockResolvedValue({ ...response, message: { ...response.message, content: JSON.stringify({ verdict: 'allow', reason }) } });
    const result = await service.evaluateApproval(request);
    expect(result).toEqual({ status: 'fallback', verdict: 'ask_user', reason: 'invalid_output' });
    expect(result).not.toHaveProperty('model'); expect(await service.consume(result)).toBe(false);
  });
  it('consumes a valid receipt exactly once and releases its reservation', async () => {
    const { service, request } = setup();
    const result = await service.evaluateApproval(request);
    expect(await service.consume(result)).toBe(true);
    expect(await service.consume(result)).toBe(false);
  });
  it('invalidates a returned receipt when reentered before policy consumption', async () => {
    const { service, request } = setup();
    const result = await service.evaluateApproval(request);
    expect(await service.evaluateApproval(request)).toHaveProperty('reason', 'reentrant');
    expect(await service.consume(result)).toBe(false);
  });
  it('builds evidence from the same immutable snapshot as its fingerprint across settings awaits', async () => {
    const { service, transport, decisions, request } = setup();
    let release!: (value: typeof config) => void;
    decisions.getConfig.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = service.evaluateApproval(request);
    request.args.path = '/changed-during-settings';
    transport.post.mockImplementation(async () => { request.args.path = '/project/readme.md'; return envelope('allow'); });
    release(config);
    const result = await pending;
    const sent = transport.post.mock.calls[0]![1];
    expect(sent).toContain('/project/readme.md');
    expect(sent).not.toContain('/changed-during-settings');
    service.discard(result);
  });
  it('invalidates both reentrant calls for one tool call', async () => {
    const { service, transport, request } = setup();
    let release!: (value: ReturnType<typeof envelope>) => void;
    transport.post.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const first = service.evaluateApproval(request);
    await vi.waitFor(() => expect(transport.post).toHaveBeenCalledTimes(1));
    expect(await service.evaluateApproval(request)).toHaveProperty('reason', 'reentrant');
    release(envelope('allow'));
    expect(await first).toHaveProperty('reason', 'stale');
    expect(transport.post).toHaveBeenCalledTimes(1);
  });
});
