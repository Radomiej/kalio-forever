import type { RaAppNativeResult, RaAppPendingApproval } from '@kalio/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTestSupportRaAppController } from './chat-test-support-raapp.controller';

function makeService() {
  return {
    seedRaAppHitlFixture: vi.fn(),
  };
}

describe('ChatTestSupportRaAppController', () => {
  let service: ReturnType<typeof makeService>;
  let controller: ChatTestSupportRaAppController;

  beforeEach(() => {
    service = makeService();
    controller = new ChatTestSupportRaAppController(service as never);
  });

  it('delegates seeded RA-App HITL payloads to ChatTestSupportService', async () => {
    const response: {
      toolCallId: string;
      pendingApprovals: RaAppPendingApproval[];
      nativeResults: RaAppNativeResult[];
    } = {
      toolCallId: 'tc-1',
      pendingApprovals: [{
        id: 'approval-1',
        system: 'vfs_write',
        displayLabel: 'Write file',
        args: { path: 'file.txt' },
      }],
      nativeResults: [],
    };
    service.seedRaAppHitlFixture.mockResolvedValue(response);

    const body = {
      sessionId: 'sess-1',
      toolCallId: 'tc-1',
      promptMessage: 'Prompt',
      assistantMessage: 'Assistant',
      block: {
        type: 'html' as const,
        mode: 'interactive' as const,
        content: '<html></html>',
      },
      approvals: [{
        id: 'approval-1',
        system: 'vfs_write',
        displayLabel: 'Write file',
        args: { path: 'file.txt' },
      }],
    };

    await expect(controller.seed(body)).resolves.toEqual(response);
    expect(service.seedRaAppHitlFixture).toHaveBeenCalledWith(body);
  });
});