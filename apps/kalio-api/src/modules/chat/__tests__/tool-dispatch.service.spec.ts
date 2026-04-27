import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ToolDispatchService } from '../tool-dispatch.service';
import { TurnState } from '../turn-state';
import { TOOL_REGISTRY } from '../chat.tokens';
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
});
