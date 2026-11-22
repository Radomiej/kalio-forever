import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSubagentActivityObserver } from './subagent-execution-activity';
import { createSubagentExecutionBudget } from './subagent-execution-budget';
import { createSubagentTrackingEmit } from './subagent-runtime.support';

function fixture() {
  const noteActivity = vi.fn();
  return { noteActivity, observe: createSubagentActivityObserver({ sessionId: 'child', turnId: 'turn', noteActivity }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('subagent meaningful activity', () => {
  it('counts native tool lifecycle changes once, not repeated running notifications', () => {
    const f = fixture(); const data = { kalioSessionId: 'child', turnId: 'turn', toolCallId: 'native' };
    for (const toolStatus of ['pending', 'pending', 'in_progress', 'in_progress', 'completed', 'completed']) {
      f.observe('devin-cli-acp.tool', { ...data, toolStatus });
    }
    f.observe('devin-cli-acp.tool', { ...data, title: 'Still running' });
    f.observe('devin-cli-acp.tool', { ...data, toolStatus: 'unknown' });
    f.observe('devin-cli-acp.tool', { ...data, turnId: 'stale', toolStatus: 'failed' });
    f.observe('devin-cli-acp.tool', { ...data, kalioSessionId: 'other', toolStatus: 'failed' });
    f.observe('devin-cli-acp.tool', { ...data, turnId: undefined, toolStatus: 'failed' });
    expect(f.noteActivity).toHaveBeenCalledTimes(3);
  });
  it('expires after native progress stops and never revives an aborted execution', async () => {
    vi.useFakeTimers(); const controller = new AbortController(); const expired = vi.fn();
    const budget = createSubagentExecutionBudget({ timeoutMs: 50, mode: 'idle', signal: controller.signal,
      isCurrent: () => true, onExpired: expired }); budget.start();
    const observe = createSubagentActivityObserver({ sessionId: 'child', turnId: 'turn', noteActivity: budget.noteActivity });
    const data = { kalioSessionId: 'child', turnId: 'turn', toolCallId: 'native', toolStatus: 'in_progress' };
    await vi.advanceTimersByTimeAsync(40); observe('devin-cli-acp.tool', data);
    await vi.advanceTimersByTimeAsync(40); observe('devin-cli-acp.tool', data);
    await vi.advanceTimersByTimeAsync(10); expect(expired).toHaveBeenCalledOnce();
    controller.abort(); observe('devin-cli-acp.tool', { ...data, toolStatus: 'completed' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('counts nonempty text and thought deltas, including legitimately repeated tokens', () => {
    const f = fixture();
    f.observe('chat:chunk', { sessionId: 'child', delta: 'work', thinking: true });
    f.observe('chat:chunk', { sessionId: 'child', delta: 'work' });
    f.observe('chat:chunk', { sessionId: 'child', delta: '' });
    expect(f.noteActivity).toHaveBeenCalledTimes(2);
  });
  it('deduplicates tool lifecycle notifications by phase and call identity', () => {
    const f = fixture(); const start = { sessionId: 'child', turnId: 'turn', callId: 'a', toolName: 'read', args: {} };
    f.observe('tool:start', start); f.observe('tool:start', start);
    f.observe('tool:result', { ...start, status: 'success' }); f.observe('tool:result', { ...start, status: 'success' });
    f.observe('tool:result', { ...start, callId: 'b', status: 'error' });
    expect(f.noteActivity).toHaveBeenCalledTimes(3);
  });
  it('counts increasing argument bytes, not repeated progress counters', () => {
    const f = fixture(); const data = { sessionId: 'child', toolName: 'write', totalChars: 10 };
    f.observe('tool:arg_progress', data); f.observe('tool:arg_progress', data);
    f.observe('tool:arg_progress', { ...data, totalChars: 9 });
    f.observe('tool:arg_progress', { ...data, totalChars: 20 });
    f.observe('tool:start', { ...data, callId: 'a', args: {} });
    f.observe('tool:arg_progress', data);
    expect(f.noteActivity).toHaveBeenCalledTimes(4);
  });
  it('ignores status heartbeats, budget events and foreign session or turn data', () => {
    const f = fixture();
    for (const event of ['agent:start', 'agent:budget_progress', 'session:status', 'runtime:event']) {
      f.observe(event, { sessionId: 'child', delta: 'heartbeat', status: 'running' });
    }
    f.observe('chat:chunk', { sessionId: 'other', delta: 'text' });
    f.observe('chat:chunk', { sessionId: 'child', turnId: 'old', delta: 'text' });
    expect(f.noteActivity).not.toHaveBeenCalled();
  });
  it('tracks progress even without a UI emitter and does not pause silent tool awaits', async () => {
    vi.useFakeTimers(); const controller = new AbortController(); const expired = vi.fn();
    const budget = createSubagentExecutionBudget({ timeoutMs: 50, mode: 'idle', signal: controller.signal,
      isCurrent: () => true, onExpired: expired }); budget.start();
    const observer = createSubagentActivityObserver({ sessionId: 'child', turnId: 'turn', noteActivity: budget.noteActivity });
    const emit = createSubagentTrackingEmit({ runtimeKind: 'agent-flow-branch', childSessionId: 'child', turnId: 'turn',
      onChunk: vi.fn(), onActivity: observer });
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(40);
      emit?.('chat:chunk', { sessionId: 'child', messageId: 'm', delta: 'progress', done: false });
      expect(expired).not.toHaveBeenCalled();
    }
    emit?.('tool:start', { sessionId: 'child', callId: 'a', toolName: 'read', args: {} });
    await vi.advanceTimersByTimeAsync(50); expect(expired).toHaveBeenCalledOnce();
    budget.dispose();
  });
});
