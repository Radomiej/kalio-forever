import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ToolDispatchService } from '../tool-dispatch.service';
import { TurnState } from '../turn-state';
import { TOOL_REGISTRY } from '../chat.tokens';
import { MCPService } from '../../mcp/mcp.service';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { ToolRegistryEntry } from '../interfaces/tool-registry-entry.interface';

function makeCtx(): StreamContext & { emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  return {
    sessionId: 'sid',
    messageId: 'mid',
    abortSignal: new AbortController().signal,
    state: new TurnState(),
    emit,
  };
}

function makeEntry(name: string, requiresConfirmation: boolean, result: unknown): ToolRegistryEntry {
  return {
    meta: { name, description: 'test', parameters: {}, requiresConfirmation },
    execute: vi.fn().mockResolvedValue(result),
  };
}

describe('ToolDispatchService', () => {
  describe('dispatch — no confirmation required', () => {
    let service: ToolDispatchService;
    let entry: ToolRegistryEntry;

    beforeEach(async () => {
      entry = makeEntry('simple_tool', false, { value: 42 });

      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();

      service = moduleRef.get(ToolDispatchService);
    });

    it('returns success result for known tool', async () => {
      const ctx = makeCtx();
      const result = await service.dispatch('call-1', 'simple_tool', { x: 1 }, ctx);
      expect(result).toEqual({ callId: 'call-1', status: 'success', data: { value: 42 } });
    });

    it('calls execute with correct ToolCallRequest', async () => {
      const ctx = makeCtx();
      await service.dispatch('call-x', 'simple_tool', { a: 'b' }, ctx);
      expect(entry.execute).toHaveBeenCalledWith({
        sessionId: 'sid',
        toolName: 'simple_tool',
        args: { a: 'b' },
        callId: 'call-x',
      });
    });

    it('returns error for unknown tool', async () => {
      const ctx = makeCtx();
      const result = await service.dispatch('call-1', 'missing_tool', {}, ctx);
      expect(result.status).toBe('error');
      expect(result.errorCode).toBe('TOOL_NOT_FOUND');
    });

    it('returns error when execute throws', async () => {
      entry.execute = vi.fn().mockRejectedValue(new Error('exec failed'));
      const ctx = makeCtx();
      const result = await service.dispatch('call-1', 'simple_tool', {}, ctx);
      expect(result.status).toBe('error');
      expect(result.errorCode).toBe('TOOL_EXECUTION_FAILED');
      expect(result.errorMessage).toContain('exec failed');
    });
  });

  describe('dispatch — confirmation required', () => {
    let service: ToolDispatchService;

    beforeEach(async () => {
      const entry = makeEntry('dangerous_tool', true, { done: true });

      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();

      service = moduleRef.get(ToolDispatchService);
    });

    it('emits tool:confirmation_required and returns cancelled when rejected', async () => {
      const ctx = makeCtx();

      // Immediately cancel after the confirmation_required event is emitted
      ctx.emit.mockImplementation((event: string, data: Record<string, string>) => {
        if (event === 'tool:confirmation_required') {
          setImmediate(() => service.cancelConfirmation(data['requestId']));
        }
      });

      const result = await service.dispatch('c1', 'dangerous_tool', {}, ctx);
      expect(ctx.emit).toHaveBeenCalledWith('tool:confirmation_required', expect.objectContaining({
        toolName: 'dangerous_tool',
        sessionId: 'sid',
      }));
      expect(result.status).toBe('cancelled');
    });

    it('executes tool when confirmed', async () => {
      const ctx = makeCtx();

      ctx.emit.mockImplementation((event: string, data: Record<string, string>) => {
        if (event === 'tool:confirmation_required') {
          setImmediate(() => service.resolveConfirmation(data['requestId']));
        }
      });

      const result = await service.dispatch('c1', 'dangerous_tool', {}, ctx);
      expect(result.status).toBe('success');
    });
  });

  describe('getToolMetas', () => {
    it('returns metas for all registered tools', async () => {
      const entries = [
        makeEntry('tool_a', false, null),
        makeEntry('tool_b', true, null),
      ];
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: entries },
        ],
      }).compile();

      const service = moduleRef.get(ToolDispatchService);
      const metas = service.getToolMetas();
      expect(metas).toHaveLength(2);
      expect(metas.map(m => m.name)).toEqual(['tool_a', 'tool_b']);
    });
  });

  describe('dispatch — MCP tool routing', () => {
    it('routes tool name to MCPService and returns success', async () => {
      const mcpService = {
        resolveToolName: vi.fn().mockReturnValue({ serverId: 's1', originalName: 'search' }),
        callTool: vi.fn().mockResolvedValue({ results: [] }),
        getToolByName: vi.fn().mockReturnValue(
          { name: 'mcp_s1_search', description: 'search', parameters: {}, requiresConfirmation: false, serverId: 's1' },
        ),
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [] },
          { provide: MCPService, useValue: mcpService },
        ],
      }).compile();
      const service = moduleRef.get(ToolDispatchService);
      const ctx = makeCtx();
      const result = await service.dispatch('c1', 'mcp_s1_search', { q: 'test' }, ctx);
      expect(result.status).toBe('success');
      expect(mcpService.callTool).toHaveBeenCalledWith('s1', 'search', { q: 'test' });
    });

    it('triggers HITL confirmation for MCP tool with requiresConfirmation=true', async () => {
      const mcpService = {
        resolveToolName: vi.fn().mockReturnValue({ serverId: 's1', originalName: 'delete_file' }),
        callTool: vi.fn().mockResolvedValue({ deleted: true }),
        getToolByName: vi.fn().mockReturnValue(
          { name: 'mcp_s1_delete_file', description: 'Deletes a file', parameters: {}, requiresConfirmation: true, serverId: 's1' },
        ),
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [] },
          { provide: MCPService, useValue: mcpService },
        ],
      }).compile();
      const service = moduleRef.get(ToolDispatchService);
      const ctx = makeCtx();
      ctx.emit.mockImplementation((event: string, data: Record<string, string>) => {
        if (event === 'tool:confirmation_required') {
          setImmediate(() => service.cancelConfirmation(data['requestId']));
        }
      });

      const result = await service.dispatch('c1', 'mcp_s1_delete_file', {}, ctx);
      expect(ctx.emit).toHaveBeenCalledWith('tool:confirmation_required', expect.objectContaining({
        toolName: 'mcp_s1_delete_file',
        sessionId: 'sid',
      }));
      expect(result.status).toBe('cancelled');
      expect(mcpService.callTool).not.toHaveBeenCalled();
    });

    it('executes MCP tool without HITL when requiresConfirmation=false', async () => {
      const mcpService = {
        resolveToolName: vi.fn().mockReturnValue({ serverId: 's1', originalName: 'list_files' }),
        callTool: vi.fn().mockResolvedValue({ files: [] }),
        getToolByName: vi.fn().mockReturnValue(
          { name: 'mcp_s1_list_files', description: 'Lists files', parameters: {}, requiresConfirmation: false, serverId: 's1' },
        ),
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [] },
          { provide: MCPService, useValue: mcpService },
        ],
      }).compile();
      const service = moduleRef.get(ToolDispatchService);
      const ctx = makeCtx();
      const result = await service.dispatch('c1', 'mcp_s1_list_files', {}, ctx);
      expect(result.status).toBe('success');
      expect(ctx.emit).not.toHaveBeenCalledWith('tool:confirmation_required', expect.anything());
    });

    it('returns error result when MCP callTool throws', async () => {
      const mcpService = {
        resolveToolName: vi.fn().mockReturnValue({ serverId: 's1', originalName: 'broken_tool' }),
        callTool: vi.fn().mockRejectedValue(new Error('MCP connection lost')),
        getToolByName: vi.fn().mockReturnValue(
          { name: 'mcp_s1_broken_tool', description: 'Broken', parameters: {}, requiresConfirmation: false, serverId: 's1' },
        ),
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [] },
          { provide: MCPService, useValue: mcpService },
        ],
      }).compile();
      const service = moduleRef.get(ToolDispatchService);
      const ctx = makeCtx();
      const result = await service.dispatch('c1', 'mcp_s1_broken_tool', {}, ctx);
      expect(result.status).toBe('error');
      expect((result as { errorCode: string }).errorCode).toBe('TOOL_EXECUTION_FAILED');
      expect((result as { errorMessage: string }).errorMessage).toContain('MCP connection lost');
    });
  });
});
