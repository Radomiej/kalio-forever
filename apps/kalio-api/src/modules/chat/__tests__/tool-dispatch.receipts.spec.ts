import { describe, expect, it, vi } from 'vitest';
import type { HostResolvedToolDispatch, ToolCallRequest } from '@kalio/types';
import { ToolDispatchService } from '../tool-dispatch.service';
import { ToolConfirmationService } from '../tool-confirmation.service';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { MCPService } from '../../mcp/mcp.service';

function context(): StreamContext {
  return { sessionId: 'session', runId: 'journal', turnId: 'turn', promptMessageId: 'prompt',
    messageId: 'assistant', abortSignal: new AbortController().signal, state: new TurnState(), emit: () => undefined };
}

describe('resolved host dispatch receipts', () => {
  it.each(['unknown', 'unavailable', 'denied', 'aborted'] as const)('never emits executed authority for %s calls', async kind => {
    let effects = 0;
    const confirmations = new ToolConfirmationService(null, null);
    vi.spyOn(confirmations, 'approveOrRequestConfirmation').mockResolvedValue({ approved: false });
    const service = new ToolDispatchService([{ meta: { name: 'safe', description: '', parameters: {}, requiresConfirmation: kind === 'denied' },
      execute: async () => { effects++; } }], null, null, null, null, confirmations);
    const gate = vi.fn(async () => undefined);
    const result = await service.dispatch('call', kind === 'unknown' ? 'unknown' : 'safe', {}, { ...context(),
      abortSignal: kind === 'aborted' ? AbortSignal.abort() : context().abortSignal,
      onResolvedToolDispatch: gate }, kind === 'unavailable' ? [] : undefined);
    expect(result.status).not.toBe('success'); expect(effects).toBe(0); expect(gate).not.toHaveBeenCalled();
  });

  it.each(['not_required', 'explicit_bypass', 'subagent_auto', 'policy', 'representative', 'legacy_confirmation'] as const)(
    'classifies %s without durable/human proof', async reason => {
      const confirmations = new ToolConfirmationService(null, null);
      vi.spyOn(confirmations, 'approveOrRequestConfirmation').mockResolvedValue({ approved: true,
        ...(reason === 'policy' || reason === 'representative' || reason === 'legacy_confirmation' ? { nonDurableReason: reason } : {}) });
      const service = new ToolDispatchService([{ meta: { name: 'fs_write', description: '', parameters: {}, requiresConfirmation: reason !== 'not_required' },
        execute: async () => 'done' }], null, null, null, null, confirmations);
      let receipt: HostResolvedToolDispatch | undefined;
      const ctx: StreamContext = { ...context(), onResolvedToolDispatch: async value => { receipt = value; },
        ...(reason === 'subagent_auto' ? { agentRun: { agentType: 'subagent', agentRunId: 'child',
          parentSessionId: 'parent', parentToolCallId: 'parent-call', autoApproveTools: ['fs_write'] } } : {}) };
      const result = reason === 'explicit_bypass'
        ? await service.dispatchApproved('call', 'fs_write', {}, ctx) : await service.dispatch('call', 'fs_write', {}, ctx);
      expect(result.status).toBe('success');
      expect(receipt?.approval).toEqual({ kind: 'non_durable', reason });
    });

  it('keeps an MCP target distinct from a Kalio registry executor and uses its captured target', async () => {
    const target = { serverKey: 'external', originalName: 'build' };
    const calls: unknown[][] = [];
    const mcp = { resolveToolName: () => target, callTool: async (...args: unknown[]) => { calls.push(args); return 'external'; } };
    const confirmations = new ToolConfirmationService(null, null);
    vi.spyOn(confirmations, 'approveOrRequestConfirmation').mockImplementation(async () => {
      target.serverKey = 'replacement'; return { approved: true };
    });
    const service = new ToolDispatchService([], mcp as unknown as MCPService, null, null, null, confirmations);
    let receipt: HostResolvedToolDispatch | undefined;
    expect(await service.dispatch('call', 'mcp_external_build', { command: 'build' }, { ...context(),
      onResolvedToolDispatch: async value => { receipt = value; target.serverKey = 'gate-replacement'; target.originalName = 'delete'; } })).toMatchObject({ status: 'success' });
    expect(receipt?.target).toEqual({ kind: 'external_mcp', serverKey: 'external', originalName: 'build' });
    expect(calls[0]?.slice(0, 2)).toEqual(['external', 'build']);
    expect(calls[0]?.[2]).toBe(receipt?.args);
  });

  it('rejects forged getters without reading them or executing', async () => {
    let reads = 0; let effects = 0;
    const args = Object.defineProperty({}, 'proof', { enumerable: true, get: () => { reads++; return 'forged'; } });
    const service = new ToolDispatchService([{ meta: { name: 'safe', description: '', parameters: {}, requiresConfirmation: false },
      execute: async () => { effects++; } }], null, null, null);
    await expect(service.dispatch('call', 'safe', args, { ...context(), onResolvedToolDispatch: async () => undefined })).rejects.toThrow();
    expect(reads).toBe(0); expect(effects).toBe(0);
  });

  it('rejects registry metadata drift before approval and preserves unobserved args behavior', async () => {
    const entry = { meta: { name: 'safe', description: '', parameters: {}, requiresConfirmation: false }, execute: async (req: ToolCallRequest) => req.args };
    const service = new ToolDispatchService([entry], null, null, null);
    entry.meta.name = 'foreign';
    await expect(service.dispatch('call', 'safe', {}, { ...context(), onResolvedToolDispatch: async () => undefined })).rejects.toThrow('HOST_DISPATCH_REGISTRY_MISMATCH');
    const args = { nested: {} };
    expect((await service.dispatch('legacy', 'safe', args, context())).data).toBe(args);
  });
  it('awaits the host gate, pins the executor before approval and detaches the executed args', async () => {
    const effects: ToolCallRequest[] = [];
    const original = async (request: ToolCallRequest) => { effects.push(request); return 'original'; };
    const entry = { meta: { name: 'terminal_spawn', description: '', parameters: {}, requiresConfirmation: true }, execute: original };
    const confirmations = new ToolConfirmationService(null, null);
    const args = { nested: { command: 'approved' }, resolvedDispatch: 'forged' };
    vi.spyOn(confirmations, 'approveOrRequestConfirmation').mockImplementation(async () => {
      entry.execute = async () => 'replacement'; args.nested.command = 'changed';
      return { approved: true, execution: { requestId: 'approval', revision: 3 } };
    });
    const service = new ToolDispatchService([entry], null, null, null, null, confirmations);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let receipt: HostResolvedToolDispatch | undefined;
    const run = service.dispatch('call', 'terminal_spawn', args, { ...context(),
      registerToolResultReceiptCommit: () => undefined,
      onResolvedToolDispatch: async value => { receipt = value; await gate; } });
    await vi.waitFor(() => expect(receipt).toBeDefined());
    expect(effects).toEqual([]);
    release();
    expect(await run).toMatchObject({ status: 'success', data: 'original' });
    expect(receipt?.target).toMatchObject({ kind: 'kalio_registry', entryIdentity: entry, executorIdentity: original });
    expect(receipt?.approval).toEqual({ kind: 'durable_confirmation', requestId: 'approval', claimedRevision: 3 });
    expect(receipt?.args).toBe(effects[0]?.args);
    expect(effects[0]?.args.nested).toEqual({ command: 'approved' });
    expect(Object.isFrozen(effects[0]?.args.nested)).toBe(true);
    expect(effects[0]).not.toHaveProperty('onResolvedToolDispatch');
  });

  it('rejects the host gate before side effects without swallowing its error', async () => {
    let effects = 0;
    const service = new ToolDispatchService([{ meta: { name: 'safe', description: '', parameters: {}, requiresConfirmation: false },
      execute: async () => { effects++; } }], null, null, null);
    await expect(service.dispatch('call', 'safe', {}, { ...context(), onResolvedToolDispatch: async () => {
      throw new Error('host refused');
    } })).rejects.toThrow('host refused');
    expect(effects).toBe(0);
  });
});
