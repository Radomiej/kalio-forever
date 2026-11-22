import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { MCPTool, ToolCallRequest, ToolMeta } from '@kalio/types';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';
import { TerminalSpawnTool } from '../../tool/tools/terminal.tools';
import type { TerminalService } from '../../tool/terminal.service';
import type { MCPService } from '../../mcp/mcp.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { ToolConfirmationService } from '../tool-confirmation.service';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';
import { dispatchRuntimeTool, TurnExecutionLane } from '../llm-turn-tool-execution';
import type { LLMAgentLoopRequest } from '../llm-turn-runtime.types';
import type { SessionManagerService } from '../session-manager.service';

function fixture() {
  const spawn = vi.fn(async () => ({ id: 'terminal', pid: 1, command: 'node' }));
  const tool = new TerminalSpawnTool({ spawn } as unknown as TerminalService);
  const meta = structuredClone(new Reflector().get<ToolMeta>(TOOL_METADATA, TerminalSpawnTool));
  const execute = vi.fn((request: ToolCallRequest) => tool.execute(request));
  const confirmations = new ToolConfirmationService(null, null);
  const approve = vi.spyOn(confirmations, 'approveOrRequestConfirmation').mockResolvedValue({ approved: true });
  const service = new ToolDispatchService([{ meta, execute }], null, null, null, null, confirmations);
  const ctx: StreamContext = { sessionId: 'session', messageId: 'message', abortSignal: new AbortController().signal,
    state: new TurnState(), emit: vi.fn(), markToolRunning: vi.fn(async () => undefined) };
  return { service, ctx, meta, execute, approve, spawn };
}

describe('canonical argument validation before policy/HITL', () => {
  it.each([
    {}, { command: 'node' }, { cwd: '/project' }, { command: 1, cwd: '/project' },
    { command: 'node', cwd: '/project', args: [1] },
    { command: '', cwd: '/project' }, { command: ' \t\n', cwd: '/project' },
    { command: 'node', cwd: '  ' },
  ])('rejects malformed terminal args %j without requesting approval or entering executor', async args => {
    const f = fixture();
    const result = await f.service.dispatch('call', 'terminal_spawn', args, f.ctx);
    expect(result).toMatchObject({ status: 'error', errorCode: 'INVALID_ARGUMENT' });
    expect(result.errorMessage).toContain('terminal_spawn');
    expect(result.errorMessage).not.toMatch(/user rejected|not approved/i);
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.ctx.emit).not.toHaveBeenCalled();
    expect(f.ctx.markToolRunning).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled(); expect(f.spawn).not.toHaveBeenCalled();
  });
  it('cannot weaken the canonical schema using caller-provided tool metadata', async () => {
    const f = fixture();
    expect(await f.service.dispatch('call', 'terminal_spawn', {}, f.ctx,
      [{ ...f.meta, parameters: {}, requiresConfirmation: false }])).toMatchObject({ errorCode: 'INVALID_ARGUMENT' });
    expect(f.approve).not.toHaveBeenCalled(); expect(f.spawn).not.toHaveBeenCalled();
  });
  it('validates the explicit approved path too', async () => {
    const f = fixture();
    expect(await f.service.dispatchApproved('call', 'terminal_spawn', {}, f.ctx)).toMatchObject({ errorCode: 'INVALID_ARGUMENT' });
    expect(f.spawn).not.toHaveBeenCalled();
  });
  it('settles an observed invalid call as an error without executed authority, then accepts a corrected call', async () => {
    const f = fixture(); const lane = new TurnExecutionLane();
    const observer = { admit: vi.fn(async () => undefined), commit: vi.fn(async () => undefined),
      resolvedDispatch: vi.fn(async () => undefined), drain: vi.fn(async () => undefined),
      journalComplete: vi.fn(async () => undefined) };
    const request = { runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt',
      toolMetas: [f.meta], emit: f.ctx.emit, hostRuntimeReceiptObserver: observer } as unknown as LLMAgentLoopRequest;
    const saveToolResult = vi.fn<SessionManagerService['saveToolResult']>(async () => 'persisted-result');
    const context = { ...f.ctx, runId: 'run', turnId: 'turn', promptMessageId: 'prompt' };
    const dispatch = (id: string, args: Record<string, unknown>) => dispatchRuntimeTool({ request, context, lane,
      sessionManager: { saveToolResult } as unknown as SessionManagerService, toolDispatch: f.service,
      call: { id, name: 'terminal_spawn', args } });
    expect(await dispatch('invalid', {})).toMatchObject({ status: 'error', errorCode: 'INVALID_ARGUMENT' });
    expect(observer.resolvedDispatch).not.toHaveBeenCalled();
    expect(observer.commit).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', resolvedDispatch: null,
      registeredCommitAck: 'not_registered' }));
    expect(saveToolResult.mock.calls[0]?.[2]).toContain('"errorCode":"INVALID_ARGUMENT"');
    expect(f.approve).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
    expect(await dispatch('corrected', { command: 'node', cwd: '/project' })).toMatchObject({ status: 'success' });
    await lane.drain();
    expect(f.approve).toHaveBeenCalledOnce(); expect(f.execute).toHaveBeenCalledOnce();
    expect(observer.resolvedDispatch).toHaveBeenCalledOnce(); expect(observer.commit).toHaveBeenCalledTimes(2);
    expect(saveToolResult).toHaveBeenCalledTimes(2);
  });
  it('does not let subagent auto-approval bypass argument validation', async () => {
    const f = fixture();
    const ctx = { ...f.ctx, agentRun: { agentType: 'subagent' as const, agentRunId: 'child',
      parentSessionId: 'parent', parentToolCallId: 'parent-call', autoApproveTools: ['terminal_spawn'] } };
    expect(await f.service.dispatch('call', 'terminal_spawn', {}, ctx)).toMatchObject({ errorCode: 'INVALID_ARGUMENT' });
    expect(f.approve).not.toHaveBeenCalled(); expect(f.spawn).not.toHaveBeenCalled();
  });
  it('fails closed for an invalid canonical registry schema before confirmation', async () => {
    const f = fixture(); f.meta.parameters = { type: 'bad-schema' };
    expect(await f.service.dispatch('call', 'terminal_spawn', {}, f.ctx)).toMatchObject({ errorCode: 'INVALID_ARGUMENT' });
    expect(f.approve).not.toHaveBeenCalled(); expect(f.spawn).not.toHaveBeenCalled();
  });
  it('keeps valid arguments unchanged and preserves confirmation before execution', async () => {
    const f = fixture(); const args = { command: 'node', cwd: '/project', args: ['--version'] };
    const before = structuredClone(args);
    expect(await f.service.dispatch('call', 'terminal_spawn', args, f.ctx)).toMatchObject({ status: 'success' });
    expect(args).toEqual(before); expect(f.approve).toHaveBeenCalledOnce(); expect(f.execute).toHaveBeenCalledOnce();
    expect(f.approve.mock.invocationCallOrder[0]).toBeLessThan(f.execute.mock.invocationCallOrder[0]!);
    expect(f.spawn).toHaveBeenCalledOnce();
  });
  it('keeps denial feedback for an actually denied valid request', async () => {
    const f = fixture(); f.approve.mockResolvedValue({ approved: false, rejectionMessage: 'Explicit denial' });
    expect(await f.service.dispatch('call', 'terminal_spawn', { command: 'node', cwd: '/project' }, f.ctx))
      .toMatchObject({ status: 'cancelled', errorMessage: 'Explicit denial' });
    expect(f.spawn).not.toHaveBeenCalled();
  });
  it.each([false, true])('validates external canonical MCP schema; valid=%s', async valid => {
    const f = fixture();
    const canonical: MCPTool = { name: 'mcp_server_tool', serverKey: 'server', description: 'Tool', requiresConfirmation: true,
      parameters: { type: 'object', required: ['value'], properties: { value: { type: 'number' } } } };
    const callTool = vi.fn(async () => ({ ok: true }));
    const mcp = { resolveToolName: () => ({ serverKey: 'server', originalName: 'tool' }),
      getToolByName: vi.fn(() => canonical), callTool } as unknown as MCPService;
    const confirmations = new ToolConfirmationService(null, null);
    const approve = vi.spyOn(confirmations, 'approveOrRequestConfirmation').mockResolvedValue({ approved: true });
    const service = new ToolDispatchService([], mcp, null, null, null, confirmations);
    const result = await service.dispatch('call', canonical.name, valid ? { value: 1 } : {}, f.ctx,
      [{ name: canonical.name, description: '', parameters: {}, requiresConfirmation: false }]);
    expect(result).toMatchObject(valid ? { status: 'success' } : { status: 'error', errorCode: 'INVALID_ARGUMENT' });
    expect(approve).toHaveBeenCalledTimes(valid ? 1 : 0); expect(callTool).toHaveBeenCalledTimes(valid ? 1 : 0);
  });
});
