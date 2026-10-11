import { describe, expect, it, vi } from 'vitest';
import { ToolDispatchService } from '../tool-dispatch.service';
import { TurnState } from '../turn-state';
import type { HostResolvedToolDispatch } from '@kalio/types';

function fixture() {
  const order: string[] = [];
  const controller = new AbortController();
  const execute = vi.fn(async () => { order.push('execute'); return { text: 'ok' }; });
  const entry = { meta: { name: 'fs_read', description: 'fixture', parameters: {}, requiresConfirmation: false }, execute };
  const service = new ToolDispatchService([entry], null, null, null);
  const entered = vi.fn(() => { order.push('entered'); });
  const resolved = vi.fn(async (_receipt: HostResolvedToolDispatch) => { order.push('resolved'); });
  const context = { sessionId: 'session', runId: 'journal', turnId: 'turn', promptMessageId: 'prompt',
    messageId: 'assistant', abortSignal: controller.signal, state: new TurnState(), emit: vi.fn(),
    onResolvedToolDispatch: resolved, onToolExecutorEntered: entered };
  return { order, controller, execute, service, entered, resolved, context };
}

describe('actual host executor entry', () => {
  it('marks entry synchronously after resolution and immediately before the captured executor', async () => {
    const f = fixture();
    await f.service.dispatch('call', 'fs_read', {}, f.context);
    expect(f.order).toEqual(['resolved', 'entered', 'execute']);
    expect(f.entered).toHaveBeenCalledOnce();
  });
  it('does not mark entry or execute when Stop occurs after resolution', async () => {
    const f = fixture();
    f.resolved.mockImplementation(async () => { f.controller.abort(new Error('private reason')); });
    expect(await f.service.dispatch('call', 'fs_read', {}, f.context)).toMatchObject({ status: 'cancelled' });
    expect(f.entered).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('propagates a rejected host capture before any executor side effect', async () => {
    const f = fixture();
    f.entered.mockImplementation(() => { throw new Error('HOST_CAPTURE_REJECTED'); });
    await expect(f.service.dispatch('call', 'fs_read', {}, f.context)).rejects.toThrow('HOST_CAPTURE_REJECTED');
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('keeps legacy calls outside the observed host-entry lane', async () => {
    const f = fixture();
    const { onResolvedToolDispatch: _resolved, ...legacy } = f.context;
    await f.service.dispatch('call', 'fs_read', {}, legacy);
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.entered).not.toHaveBeenCalled();
  });
  it.each(['async', 'promise'])('rejects %s entry capture without executing the tool', async kind => {
    const f = fixture();
    const capture = kind === 'async' ? async () => undefined : () => Promise.resolve();
    await expect(f.service.dispatch('call', 'fs_read', {}, { ...f.context,
      onToolExecutorEntered: capture })).rejects.toThrow('HOST_DISPATCH_ENTRY_ASYNC');
    expect(f.execute).not.toHaveBeenCalled();
  });
});
