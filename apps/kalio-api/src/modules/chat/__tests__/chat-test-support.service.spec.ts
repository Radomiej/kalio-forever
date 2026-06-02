import { NotFoundException } from '@nestjs/common';
import type { RaAppNativeResult, RaAppPendingApproval } from '@kalio/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingApproval } from '../../raapp/effects-processor.service';
import { ChatTestSupportService } from '../chat-test-support.service';

function makeConfig(environment: string) {
  return {
    get: vi.fn().mockReturnValue(environment),
  };
}

function makeSessions() {
  return {
    get: vi.fn().mockResolvedValue(undefined),
  };
}

function makeToolDispatch() {
  return {
    seedPendingConfirmation: vi.fn(),
    dropPendingConfirmation: vi.fn().mockReturnValue('removed'),
  };
}

function makeRaappHitl() {
  return {
    resolvePendingApprovals: vi.fn(),
  };
}

function makeRepo() {
  return {
    saveMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function makePendingApproval(overrides?: Partial<PendingApproval>): PendingApproval {
  return {
    id: 'approval-1',
    system: 'vfs_write',
    args: { path: 'e2e/result.txt', content: 'approved' },
    displayLabel: 'Write result.txt',
    ...overrides,
  };
}

function readToolResultPayload(repo: ReturnType<typeof makeRepo>): Record<string, unknown> {
  const toolResult = repo.saveMessage.mock.calls[2]?.[0] as { content: string };
  return JSON.parse(toolResult.content) as Record<string, unknown>;
}

describe('ChatTestSupportService', () => {
  let config: ReturnType<typeof makeConfig>;
  let sessions: ReturnType<typeof makeSessions>;
  let toolDispatch: ReturnType<typeof makeToolDispatch>;
  let raappHitl: ReturnType<typeof makeRaappHitl>;
  let repo: ReturnType<typeof makeRepo>;
  let service: ChatTestSupportService;

  beforeEach(() => {
    config = makeConfig('test');
    sessions = makeSessions();
    toolDispatch = makeToolDispatch();
    raappHitl = makeRaappHitl();
    repo = makeRepo();
    service = new ChatTestSupportService(
      config as never,
      sessions as never,
      toolDispatch as never,
      raappHitl as never,
      repo as never,
    );
  });

  describe('seedRaAppHitlFixture()', () => {
    it('persists seeded RA-App history with pending approvals for manual-like flows', async () => {
      const approval = makePendingApproval();
      const pendingApprovals: RaAppPendingApproval[] = [{
        id: approval.id,
        system: approval.system,
        displayLabel: approval.displayLabel,
        args: approval.args,
      }];
      raappHitl.resolvePendingApprovals.mockResolvedValue({
        pendingApprovals,
        nativeResults: [],
      });

      const result = await service.seedRaAppHitlFixture({
        sessionId: 'sess-manual',
        toolCallId: 'tc-manual',
        promptMessage: 'Launch the seeded fixture',
        assistantMessage: 'Prepared seeded RA-App fixture',
        block: {
          type: 'html',
          mode: 'interactive',
          content: '<html><body>manual</body></html>',
        },
        approvals: [approval],
      });

      expect(sessions.get).toHaveBeenCalledWith('sess-manual');
      expect(raappHitl.resolvePendingApprovals).toHaveBeenCalledWith('tc-manual', 'sess-manual', [approval]);
      expect(repo.saveMessage).toHaveBeenCalledTimes(3);
      expect(repo.saveMessage.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        sessionId: 'sess-manual',
        role: 'user',
        content: 'Launch the seeded fixture',
      }));
      expect(repo.saveMessage.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
        sessionId: 'sess-manual',
        role: 'assistant',
        content: 'Prepared seeded RA-App fixture',
        toolCalls: [expect.objectContaining({
          id: 'tc-manual',
          name: 'run_raapp',
          args: { id: 'seeded-raapp-hitl-fixture' },
        })],
      }));

      const payload = readToolResultPayload(repo);
      expect(payload).toEqual({
        status: 'ready',
        type: 'html',
        mode: 'interactive',
        content: '<html><body>manual</body></html>',
        pendingApprovals,
      });
      expect(result).toEqual({
        toolCallId: 'tc-manual',
        pendingApprovals,
        nativeResults: [],
      });
    });

    it('persists native results and optional RA-App block fields for bypass-like flows', async () => {
      const approval = makePendingApproval({ id: 'approval-bypass' });
      const nativeResults: RaAppNativeResult[] = [{
        id: approval.id,
        system: approval.system,
        status: 'executed',
        result: { written: 'e2e/result.txt' },
      }];
      raappHitl.resolvePendingApprovals.mockResolvedValue({
        pendingApprovals: [],
        nativeResults,
      });

      const result = await service.seedRaAppHitlFixture({
        sessionId: 'sess-bypass',
        toolCallId: 'tc-bypass',
        promptMessage: 'Launch bypass fixture',
        assistantMessage: 'Prepared bypass seeded RA-App fixture',
        block: {
          type: 'html',
          mode: 'interactive',
          content: '<html><body>bypass</body></html>',
          renderedContent: '<iframe>rendered</iframe>',
          vfsPath: 'apps/seeded/index.html',
        },
        approvals: [approval],
      });

      const payload = readToolResultPayload(repo);
      expect(payload).toEqual({
        status: 'ready',
        type: 'html',
        mode: 'interactive',
        content: '<html><body>bypass</body></html>',
        renderedContent: '<iframe>rendered</iframe>',
        vfsPath: 'apps/seeded/index.html',
        nativeResults,
      });
      expect(result).toEqual({
        toolCallId: 'tc-bypass',
        pendingApprovals: [],
        nativeResults,
      });
    });

    it('omits pending approvals and native results from the tool result payload when both are empty', async () => {
      raappHitl.resolvePendingApprovals.mockResolvedValue({
        pendingApprovals: [],
        nativeResults: [],
      });

      await service.seedRaAppHitlFixture({
        sessionId: 'sess-empty',
        toolCallId: 'tc-empty',
        promptMessage: 'Launch empty fixture',
        assistantMessage: 'Prepared empty seeded RA-App fixture',
        block: {
          type: 'gui',
          mode: 'display',
          content: '{"type":"gui"}',
        },
        approvals: [],
      });

      const payload = readToolResultPayload(repo);
      expect(payload).toEqual({
        status: 'ready',
        type: 'gui',
        mode: 'display',
        content: '{"type":"gui"}',
      });
    });

    it('rejects outside test mode before touching storage or HITL state', async () => {
      config = makeConfig('development');
      service = new ChatTestSupportService(
        config as never,
        sessions as never,
        toolDispatch as never,
        raappHitl as never,
        repo as never,
      );

      await expect(service.seedRaAppHitlFixture({
        sessionId: 'sess-dev',
        toolCallId: 'tc-dev',
        promptMessage: 'Prompt',
        assistantMessage: 'Assistant',
        block: {
          type: 'html',
          mode: 'interactive',
          content: '<html></html>',
        },
        approvals: [makePendingApproval()],
      })).rejects.toBeInstanceOf(NotFoundException);

      expect(sessions.get).not.toHaveBeenCalled();
      expect(raappHitl.resolvePendingApprovals).not.toHaveBeenCalled();
      expect(repo.saveMessage).not.toHaveBeenCalled();
    });

    it('propagates session lookup failures without persisting partial history', async () => {
      sessions.get.mockRejectedValue(new NotFoundException('missing session'));

      await expect(service.seedRaAppHitlFixture({
        sessionId: 'sess-missing',
        toolCallId: 'tc-missing',
        promptMessage: 'Prompt',
        assistantMessage: 'Assistant',
        block: {
          type: 'html',
          mode: 'interactive',
          content: '<html></html>',
        },
        approvals: [makePendingApproval()],
      })).rejects.toBeInstanceOf(NotFoundException);

      expect(raappHitl.resolvePendingApprovals).not.toHaveBeenCalled();
      expect(repo.saveMessage).not.toHaveBeenCalled();
    });
  });
});