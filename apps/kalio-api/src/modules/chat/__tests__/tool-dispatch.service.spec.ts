import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ToolDispatchService } from '../tool-dispatch.service';
import { TurnState } from '../turn-state';
import { TOOL_REGISTRY } from '../chat.tokens';
import { MCPService } from '../../mcp/mcp.service';
import { HitlNotificationService } from '../../hitl/hitl-notification.service';
import { HitlPolicyService } from '../../hitl/hitl-policy.service';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { ToolRegistryEntry } from '../interfaces/tool-registry-entry.interface';
import type { ToolDomain } from '@kalio/types';
import type { DrizzleService } from '../../../database/drizzle.service';
import type { MemoryService } from '../../memory/memory.service';
import type { WebSearchService } from '../../search/web-search.service';
import { WebSearchTool } from '../../tool/tools/web-search.tool';

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

function makeEntry(name: string, requiresConfirmation: boolean, result: unknown, domain?: ToolDomain): ToolRegistryEntry {
  return {
    meta: { name, description: 'test', domain, parameters: {}, requiresConfirmation },
    execute: vi.fn().mockResolvedValue(result),
  };
}

function makeDrizzleMock(personaId = 'persona-dispatch'): DrizzleService {
  const query = {
    select: vi.fn(() => query),
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    get: vi.fn(() => ({ personaId })),
  };
  return { db: query } as unknown as DrizzleService;
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
      expect(entry.execute).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'sid',
        toolName: 'simple_tool',
        args: { a: 'b' },
        callId: 'call-x',
      }));
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

    it('dispatches web_search with offline_search override and persists online result silently', async () => {
      const webSearch = {
        search: vi.fn().mockResolvedValue({
          answer: 'Fresh external answer',
          citations: ['https://example.com/fresh'],
          model: 'sonar',
          provider: 'perplexity',
        }),
      } satisfies Pick<WebSearchService, 'search'>;
      const memory = {
        searchWebResults: vi.fn().mockResolvedValue([]),
        ingestWebSearchResult: vi.fn().mockResolvedValue({ ids: ['mem-1'], count: 1 }),
      } satisfies Pick<MemoryService, 'searchWebResults' | 'ingestWebSearchResult'>;
      const webTool = new WebSearchTool(webSearch as unknown as WebSearchService, memory as unknown as MemoryService, makeDrizzleMock());
      const webEntry: ToolRegistryEntry = {
        meta: { name: 'web_search', description: 'search', parameters: {}, requiresConfirmation: false },
        execute: (req) => webTool.execute(req),
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [webEntry] },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);

      const result = await scopedService.dispatch('call-web', 'web_search', { query: 'latest status', offline_search: false }, makeCtx());

      expect(result).toEqual({
        callId: 'call-web',
        status: 'success',
        data: expect.objectContaining({ offline: false, memory: { ids: ['mem-1'], count: 1 } }),
      });
      expect(memory.searchWebResults).not.toHaveBeenCalled();
      expect(webSearch.search).toHaveBeenCalledWith('latest status');
      expect(memory.ingestWebSearchResult).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            content: 'Fresh external answer',
            citationUrls: ['https://example.com/fresh'],
            query: 'latest status',
            provider: 'perplexity',
            model: 'sonar',
          }),
        ]),
      );
      expect(result.data).toEqual(expect.objectContaining({
        results: [expect.objectContaining({ content: 'Fresh external answer' })],
      }));
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

    it('returns cancelled result with the user rejection message visible to the agent', async () => {
      const ctx = makeCtx();

      ctx.emit.mockImplementation((event: string, data: Record<string, string>) => {
        if (event === 'tool:confirmation_required') {
          setImmediate(() => service.cancelConfirmation(
            data['requestId'],
            'sid',
            'Do not write files; explain the plan instead.',
          ));
        }
      });

      const result = await service.dispatch('c1', 'dangerous_tool', {}, ctx);

      expect(result).toEqual({
        callId: 'c1',
        status: 'cancelled',
        errorMessage: 'User rejected tool confirmation: Do not write files; explain the plan instead.',
      });
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

    it('logs requested and confirmed HITL lifecycle events with the optional approval note when confirmed', async () => {
      const entry = makeEntry('dangerous_tool', true, { done: true });
      const hitlNotifications = {
        notifyApprovalRequested: vi.fn().mockResolvedValue(undefined),
        logApprovalLifecycle: vi.fn().mockResolvedValue(undefined),
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
          { provide: HitlNotificationService, useValue: hitlNotifications },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = makeCtx();

      ctx.emit.mockImplementation((event: string, data: Record<string, string>) => {
        if (event === 'tool:confirmation_required') {
          setImmediate(() => scopedService.resolveConfirmation(data['requestId'], 'sid', 'Looks safe, continue.'));
        }
      });

      const result = await scopedService.dispatch('c1', 'dangerous_tool', { path: 'demo.txt' }, ctx);

      expect(result.status).toBe('success');
      expect(hitlNotifications.notifyApprovalRequested).toHaveBeenCalledWith(expect.objectContaining({
        request: expect.objectContaining({
          kind: 'tool',
          sessionId: 'sid',
          name: 'dangerous_tool',
          toolCallId: 'c1',
        }),
      }));
      expect(hitlNotifications.logApprovalLifecycle).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'hitl_approval_confirmed',
        source: 'manual',
        reason: 'Looks safe, continue.',
        request: expect.objectContaining({
          kind: 'tool',
          sessionId: 'sid',
          name: 'dangerous_tool',
          toolCallId: 'c1',
        }),
      }));
    });

    it('ignores confirmation attempts from a different session', async () => {
      const ctx = makeCtx();
      let requestId: string | null = null;

      ctx.emit.mockImplementation((event: string, data: Record<string, string>) => {
        if (event === 'tool:confirmation_required') {
          requestId = data['requestId'];
        }
      });

      const dispatchPromise = service.dispatch('c1', 'dangerous_tool', {}, ctx);
      const settled = { done: false };
      void dispatchPromise.finally(() => {
        settled.done = true;
      });

      expect(requestId).toBeTruthy();

      service.resolveConfirmation(requestId!, 'other-session');
      await Promise.resolve();

      expect(settled.done).toBe(false);

      service.resolveConfirmation(requestId!, 'sid');
      const result = await dispatchPromise;
      expect(result.status).toBe('success');
    });

    it('ignores cancellation attempts from a different session', async () => {
      const ctx = makeCtx();
      let requestId: string | null = null;

      ctx.emit.mockImplementation((event: string, data: Record<string, string>) => {
        if (event === 'tool:confirmation_required') {
          requestId = data['requestId'];
        }
      });

      const dispatchPromise = service.dispatch('c1', 'dangerous_tool', {}, ctx);
      const settled = { done: false };
      void dispatchPromise.finally(() => {
        settled.done = true;
      });

      expect(requestId).toBeTruthy();

      service.cancelConfirmation(requestId!, 'other-session');
      await Promise.resolve();

      expect(settled.done).toBe(false);

      service.cancelConfirmation(requestId!, 'sid');
      const result = await dispatchPromise;
      expect(result.status).toBe('cancelled');
    });

    it('auto-approves isolated subagent VFS writes without HITL confirmation', async () => {
      const entry = makeEntry('vfs_write', true, { path: 'index.html' });
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = {
        ...makeCtx(),
        sessionId: 'child-session',
        vfsSessionId: 'child-session',
        agentRun: {
          agentRunId: 'sub-run-1',
          agentType: 'subagent' as const,
          parentSessionId: 'master-session',
          vfsMode: 'isolated' as const,
        },
      };

      const result = await scopedService.dispatch('c1', 'vfs_write', { filePath: 'index.html', content: '<h1>x</h1>' }, ctx);

      expect(result.status).toBe('success');
      expect(ctx.emit).not.toHaveBeenCalledWith('tool:confirmation_required', expect.anything());
      expect(entry.execute).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'child-session',
        vfsSessionId: 'child-session',
        agentRun: expect.objectContaining({ agentType: 'subagent', vfsMode: 'isolated' }),
      }));
    });

    it('rejects tool calls outside the provided runtime scope before HITL', async () => {
      const entry = makeEntry('vfs_write', true, { path: 'index.html' });
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = makeCtx();

      const result = await scopedService.dispatch(
        'c1',
        'vfs_write',
        { filePath: 'index.html', content: '<h1>x</h1>' },
        ctx,
        [{ name: 'vfs_read', description: 'Read VFS file', parameters: {}, requiresConfirmation: false }],
      );

      expect(result).toMatchObject({
        status: 'error',
        errorCode: 'TOOL_NOT_AVAILABLE',
      });
      expect(ctx.emit).not.toHaveBeenCalledWith('tool:confirmation_required', expect.anything());
      expect(entry.execute).not.toHaveBeenCalled();
    });

    it('keeps HITL confirmation for shared-VFS subagent writes', async () => {
      const entry = makeEntry('vfs_write', true, { path: 'index.html' });
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = {
        ...makeCtx(),
        sessionId: 'child-session',
        vfsSessionId: 'master-session',
        agentRun: {
          agentRunId: 'sub-run-2',
          agentType: 'subagent' as const,
          parentSessionId: 'master-session',
          vfsMode: 'shared' as const,
        },
      };
      ctx.emit.mockImplementation((event: string, data: Record<string, string>) => {
        if (event === 'tool:confirmation_required') {
          setImmediate(() => scopedService.cancelConfirmation(data['requestId']));
        }
      });

      const result = await scopedService.dispatch('c1', 'vfs_write', { filePath: 'index.html', content: '<h1>x</h1>' }, ctx);

      expect(ctx.emit).toHaveBeenCalledWith('tool:confirmation_required', expect.objectContaining({
        toolName: 'vfs_write',
        sessionId: 'child-session',
        agentRun: expect.objectContaining({ agentType: 'subagent', vfsMode: 'shared' }),
      }));
      expect(result.status).toBe('cancelled');
      expect(entry.execute).not.toHaveBeenCalled();
    });

    it('REGRESSION: unsupported autoApproveTools entries do not bypass HITL', async () => {
      const entry = makeEntry('raapp_create', true, { appId: 'visual-calculator' });
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = {
        ...makeCtx(),
        sessionId: 'child-session',
        vfsSessionId: 'child-session',
        agentRun: {
          agentRunId: 'sub-run-unsupported-auto',
          agentType: 'subagent' as const,
          parentSessionId: 'master-session',
          vfsMode: 'isolated' as const,
          autoApproveTools: ['raapp_create'],
        },
      };
      ctx.emit.mockImplementation((event: string, data: Record<string, string>) => {
        if (event === 'tool:confirmation_required') {
          setImmediate(() => scopedService.cancelConfirmation(data['requestId']));
        }
      });

      const result = await scopedService.dispatch('c1', 'raapp_create', { appId: 'visual-calculator' }, ctx);

      expect(ctx.emit).toHaveBeenCalledWith('tool:confirmation_required', expect.objectContaining({
        toolName: 'raapp_create',
        sessionId: 'child-session',
        agentRun: expect.objectContaining({
          agentType: 'subagent',
          autoApproveTools: ['raapp_create'],
        }),
      }));
      expect(result.status).toBe('cancelled');
      expect(entry.execute).not.toHaveBeenCalled();
    });

    it('REGRESSION: auto-approves shared VFS writes only when the subagent run explicitly opts in', async () => {
      const entry = makeEntry('vfs_write', true, { path: 'evidence/proof.json' });
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = {
        ...makeCtx(),
        sessionId: 'arch-run-materializer',
        vfsSessionId: 'arch-run-root',
        agentRun: {
          agentRunId: 'sub-run-materializer',
          agentType: 'subagent' as const,
          parentSessionId: 'arch-run-root',
          vfsMode: 'shared' as const,
          autoApproveTools: ['vfs_write'],
        },
      };

      const result = await scopedService.dispatch(
        'c1',
        'vfs_write',
        { filePath: 'evidence/proof.json', content: '{"status":"implemented"}' },
        ctx,
      );

      expect(result.status).toBe('success');
      expect(ctx.emit).not.toHaveBeenCalledWith('tool:confirmation_required', expect.anything());
      expect(entry.execute).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'arch-run-materializer',
        vfsSessionId: 'arch-run-root',
        agentRun: expect.objectContaining({
          agentType: 'subagent',
          vfsMode: 'shared',
          autoApproveTools: ['vfs_write'],
        }),
      }));
    });

    it('REGRESSION: optionally auto-approves a whitelisted isolated child image_generate tool', async () => {
      const entry = makeEntry('image_generate', true, { path: 'images/coffee-hero.png' });
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = {
        ...makeCtx(),
        sessionId: 'child-session',
        vfsSessionId: 'child-session',
        agentRun: {
          agentRunId: 'sub-run-allowlist',
          agentType: 'subagent' as const,
          parentSessionId: 'master-session',
          vfsMode: 'isolated' as const,
          autoApproveTools: ['image_generate'],
        },
      };

      const result = await scopedService.dispatch('c1', 'image_generate', { prompt: 'hero coffee' }, ctx);

      expect(result.status).toBe('success');
      expect(ctx.emit).not.toHaveBeenCalledWith('tool:confirmation_required', expect.anything());
      expect(entry.execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'image_generate' }));
    });

    it('REGRESSION: optionally auto-approves shared subagent CLI delegation tools', async () => {
      const entry = makeEntry('run_cli_agent', true, { sessionId: 'cli-session', status: 'completed' });
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = {
        ...makeCtx(),
        sessionId: 'architecture-orchestrator',
        vfsSessionId: 'architecture-root',
        agentRun: {
          agentRunId: 'arch-sub-run-cli',
          agentType: 'subagent' as const,
          parentSessionId: 'architecture-root',
          vfsMode: 'shared' as const,
          autoApproveTools: ['run_cli_agent'],
        },
      };

      const result = await scopedService.dispatch('c1', 'run_cli_agent', { agentId: 'copilot' }, ctx);

      expect(result.status).toBe('success');
      expect(ctx.emit).not.toHaveBeenCalledWith('tool:confirmation_required', expect.anything());
      expect(entry.execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'run_cli_agent' }));
    });

    it('REGRESSION: optionally auto-approves shared subagent host project writes', async () => {
      const entry = makeEntry('fs_write', true, { path: 'C:\\Projekty\\TurboProject2\\package.json' });
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = {
        ...makeCtx(),
        sessionId: 'architecture-materializer',
        vfsSessionId: 'architecture-root',
        agentRun: {
          agentRunId: 'arch-sub-run-fs',
          agentType: 'subagent' as const,
          parentSessionId: 'architecture-root',
          vfsMode: 'shared' as const,
          autoApproveTools: ['fs_write'],
        },
      };

      const result = await scopedService.dispatch('c1', 'fs_write', {
        path: 'C:\\Projekty\\TurboProject2\\package.json',
        content: '{"scripts":{"build":"vite build"}}',
      }, ctx);

      expect(result.status).toBe('success');
      expect(ctx.emit).not.toHaveBeenCalledWith('tool:confirmation_required', expect.anything());
      expect(entry.execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'fs_write' }));
    });

    it('optionally auto-approves shared subagent terminal spawn for architecture verification', async () => {
      const entry = makeEntry('terminal_spawn', true, { id: 'term-1' });
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = {
        ...makeCtx(),
        sessionId: 'architecture-tester',
        vfsSessionId: 'architecture-root',
        agentRun: {
          agentRunId: 'arch-sub-run-terminal',
          agentType: 'subagent' as const,
          parentSessionId: 'architecture-root',
          vfsMode: 'shared' as const,
          autoApproveTools: ['terminal_spawn'],
        },
      };

      const result = await scopedService.dispatch('c1', 'terminal_spawn', {
        command: 'npm',
        args: ['run', 'build'],
        cwd: 'C:\\Projekty\\TurboProject2',
      }, ctx);

      expect(result.status).toBe('success');
      expect(ctx.emit).not.toHaveBeenCalledWith('tool:confirmation_required', expect.anything());
      expect(entry.execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'terminal_spawn' }));
    });

    it('does not auto-timeout HITL confirmation for subagent turns', async () => {
      vi.useFakeTimers();
      try {
        const entry = makeEntry('dangerous_tool', true, { ok: true });
        const moduleRef = await Test.createTestingModule({
          providers: [
            ToolDispatchService,
            { provide: TOOL_REGISTRY, useValue: [entry] },
          ],
        }).compile();
        const scopedService = moduleRef.get(ToolDispatchService);
        const ctx = {
          ...makeCtx(),
          sessionId: 'sub-session',
          vfsSessionId: 'sub-session',
          agentRun: {
            agentRunId: 'sub-run-hitl',
            agentType: 'subagent' as const,
            parentSessionId: 'master-session',
            vfsMode: 'shared' as const,
          },
        };
        let capturedRequestId: string | null = null;
        ctx.emit.mockImplementation((event: string, data: Record<string, string | number>) => {
          if (event === 'tool:confirmation_required') {
            capturedRequestId = String(data['requestId']);
            expect(data['timeoutMs']).toBe(0);
          }
        });

        const dispatchPromise = scopedService.dispatch('c1', 'dangerous_tool', {}, ctx);

        const settled: { done: boolean; status?: string } = { done: false };
        void dispatchPromise.then((result) => {
          settled.done = true;
          settled.status = result.status;
        });

        await vi.advanceTimersByTimeAsync(700_000);
        await Promise.resolve();
        expect(settled.done).toBe(false);
        expect(capturedRequestId).toBeTruthy();

        scopedService.resolveConfirmation(capturedRequestId!);
        const result = await dispatchPromise;
        expect(result.status).toBe('success');
      } finally {
        vi.useRealTimers();
      }
    });

    it('REGRESSION: aborting a subagent HITL wait invalidates confirmation and returns cancelled', async () => {
      const entry = makeEntry('dangerous_tool', true, { ok: true });
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
        ],
      }).compile();
      const scopedService = moduleRef.get(ToolDispatchService);
      const abortController = new AbortController();
      const ctx = {
        ...makeCtx(),
        sessionId: 'sub-session',
        vfsSessionId: 'sub-session',
        abortSignal: abortController.signal,
        agentRun: {
          agentRunId: 'sub-run-abort',
          agentType: 'subagent' as const,
          parentSessionId: 'master-session',
          vfsMode: 'shared' as const,
        },
      };

      const dispatchPromise = scopedService.dispatch('c1', 'dangerous_tool', {}, ctx);

      expect(ctx.emit).toHaveBeenCalledWith('tool:confirmation_required', expect.objectContaining({
        toolName: 'dangerous_tool',
        sessionId: 'sub-session',
        timeoutMs: 0,
      }));

      abortController.abort();

      const result = await Promise.race([
        dispatchPromise,
        new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 50)),
      ]);

      expect(result).toEqual(expect.objectContaining({ status: 'cancelled' }));
      expect(ctx.emit).toHaveBeenCalledWith('tool:confirmation_invalidated', expect.objectContaining({
        reason: 'cancelled',
        message: expect.stringContaining('aborted'),
      }));
      expect(entry.execute).not.toHaveBeenCalled();
    });
  });

  describe('dispatch — configurable HITL policy', () => {
    it('skips manual confirmation when the global policy approves the tool (bypass)', async () => {
      const entry = makeEntry('dangerous_tool', true, { done: true });
      const hitlPolicy = {
        resolveApproval: vi.fn().mockResolvedValue({ status: 'approved', source: 'bypass' }),
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
          { provide: HitlPolicyService, useValue: hitlPolicy },
        ],
      }).compile();

      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = makeCtx();

      const result = await scopedService.dispatch('c-bypass', 'dangerous_tool', { path: 'demo.txt' }, ctx);

      expect(result.status).toBe('success');
      expect(hitlPolicy.resolveApproval).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'tool',
        sessionId: 'sid',
        name: 'dangerous_tool',
        args: { path: 'demo.txt' },
      }));
      expect(ctx.emit).not.toHaveBeenCalledWith('tool:confirmation_required', expect.anything());
      expect(entry.execute).toHaveBeenCalledTimes(1);
    });

    it('passes the turn abortSignal into global HITL approval evaluation', async () => {
      const entry = makeEntry('dangerous_tool', true, { done: true });
      const hitlPolicy = {
        resolveApproval: vi.fn().mockResolvedValue({ status: 'approved', source: 'bypass' }),
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
          { provide: HitlPolicyService, useValue: hitlPolicy },
        ],
      }).compile();

      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = makeCtx();

      await scopedService.dispatch('c-abort', 'dangerous_tool', { path: 'demo.txt' }, ctx);

      expect(hitlPolicy.resolveApproval).toHaveBeenCalledWith(
        expect.objectContaining({ abortSignal: ctx.abortSignal }),
      );
    });

    it('returns cancelled when the global auto HITL policy rejects the tool', async () => {
      const entry = makeEntry('dangerous_tool', true, { done: true });
      const hitlPolicy = {
        resolveApproval: vi.fn().mockResolvedValue({
          status: 'rejected',
          source: 'auto',
          reason: 'The args request a destructive write outside the allowed plan.',
        }),
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [entry] },
          { provide: HitlPolicyService, useValue: hitlPolicy },
        ],
      }).compile();

      const scopedService = moduleRef.get(ToolDispatchService);
      const ctx = makeCtx();

      const result = await scopedService.dispatch('c-auto-reject', 'dangerous_tool', { path: 'demo.txt' }, ctx);

      expect(result.status).toBe('cancelled');
      expect(ctx.emit).not.toHaveBeenCalledWith('tool:confirmation_required', expect.anything());
      expect(entry.execute).not.toHaveBeenCalled();
    });

    it('uses representative fallback only after a manual confirmation timeout', async () => {
      vi.useFakeTimers();
      try {
        const entry = makeEntry('dangerous_tool', true, { done: true });
        const hitlPolicy = {
          resolveApproval: vi.fn().mockResolvedValue({ status: 'manual', source: 'manual' }),
          resolveUnattendedApproval: vi.fn().mockResolvedValue({
            status: 'approved',
            source: 'representative',
            reason: 'User did not respond; representative approved the constrained request.',
          }),
        };
        const hitlNotifications = {
          notifyApprovalRequested: vi.fn().mockResolvedValue(undefined),
          logApprovalLifecycle: vi.fn().mockResolvedValue(undefined),
        };

        const moduleRef = await Test.createTestingModule({
          providers: [
            ToolDispatchService,
            { provide: TOOL_REGISTRY, useValue: [entry] },
            { provide: HitlPolicyService, useValue: hitlPolicy },
            { provide: HitlNotificationService, useValue: hitlNotifications },
          ],
        }).compile();

        const scopedService = moduleRef.get(ToolDispatchService);
        const ctx = makeCtx();
        const dispatchPromise = scopedService.dispatch('c-timeout', 'dangerous_tool', { path: 'demo.txt' }, ctx);
        await Promise.resolve();

        expect(ctx.emit).toHaveBeenCalledWith('tool:confirmation_required', expect.objectContaining({
          toolName: 'dangerous_tool',
          timeoutMs: 600_000,
        }));
        const requestId = (ctx.emit.mock.calls.find(([event]) => event === 'tool:confirmation_required')?.[1] as { requestId: string }).requestId;

        await vi.advanceTimersByTimeAsync(600_000);
        const result = await dispatchPromise;

        expect(result.status).toBe('success');
        expect(hitlPolicy.resolveUnattendedApproval).toHaveBeenCalledWith(expect.objectContaining({
          kind: 'tool',
          sessionId: 'sid',
          name: 'dangerous_tool',
          toolCallId: 'c-timeout',
        }));
        expect(hitlNotifications.logApprovalLifecycle).toHaveBeenCalledWith(expect.objectContaining({
          eventType: 'hitl_approval_timeout',
          requestId,
        }));
        expect(hitlNotifications.logApprovalLifecycle).toHaveBeenCalledWith(expect.objectContaining({
          eventType: 'hitl_approval_representative_approved',
          requestId,
          source: 'representative',
          reason: 'User did not respond; representative approved the constrained request.',
        }));
        expect(entry.execute).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('getToolMetas', () => {
    it('returns metas for all registered tools', async () => {
      const entries = [
        makeEntry('tool_a', false, null, 'vfs'),
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
      expect(metas[0]?.domain).toBe('vfs');
    });

    it('preserves canonical serverKey on MCP tool metas', async () => {
      const mcpService = {
        getAllTools: vi.fn().mockReturnValue([
          {
            name: 'mcp_toml::docs_search',
            description: 'search docs',
            serverKey: 'toml::docs',
            serverId: 'toml::docs',
            parameters: {},
            requiresConfirmation: false,
          },
        ]),
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          ToolDispatchService,
          { provide: TOOL_REGISTRY, useValue: [] },
          { provide: MCPService, useValue: mcpService },
        ],
      }).compile();

      const service = moduleRef.get(ToolDispatchService);
      const metas = service.getToolMetas();
      expect(metas).toEqual([
        expect.objectContaining({
          name: 'mcp_toml::docs_search',
          serverKey: 'toml::docs',
          domain: 'mcp',
        }),
      ]);
    });
  });

  describe('dispatch — MCP tool routing', () => {
    it('routes tool name to MCPService and returns success', async () => {
      const mcpService = {
        resolveToolName: vi.fn().mockReturnValue({ serverKey: 's1', originalName: 'search' }),
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
        resolveToolName: vi.fn().mockReturnValue({ serverKey: 's1', originalName: 'delete_file' }),
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
        resolveToolName: vi.fn().mockReturnValue({ serverKey: 's1', originalName: 'list_files' }),
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
        resolveToolName: vi.fn().mockReturnValue({ serverKey: 's1', originalName: 'broken_tool' }),
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
