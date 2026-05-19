import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTestSupportRaAppController } from './chat-test-support-raapp.controller';

describe('ChatTestSupportRaAppController', () => {
  let controller: ChatTestSupportRaAppController;
  let chatTestSupport: {
    seedRaAppHitlFixture: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    chatTestSupport = {
      seedRaAppHitlFixture: vi.fn().mockResolvedValue({
        toolCallId: 'tool-1',
        pendingApprovals: [{ id: 'approval-1' }],
        nativeResults: [{ type: 'success' }],
      }),
    };
    controller = new ChatTestSupportRaAppController(chatTestSupport as never);
  });

  it('forwards the seed payload to ChatTestSupportService', async () => {
    const body = {
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      promptMessage: 'prompt',
      assistantMessage: 'assistant',
      block: {
        type: 'html' as const,
        mode: 'interactive' as const,
        content: '<div>hello</div>',
      },
      approvals: [],
    };

    await expect(controller.seed(body)).resolves.toEqual({
      toolCallId: 'tool-1',
      pendingApprovals: [{ id: 'approval-1' }],
      nativeResults: [{ type: 'success' }],
    });
    expect(chatTestSupport.seedRaAppHitlFixture).toHaveBeenCalledWith(body);
    expect(Reflect.getMetadata('path', ChatTestSupportRaAppController)).toBe('test-support/raapp-hitl');
    expect(Reflect.getMetadata('path', ChatTestSupportRaAppController.prototype.seed)).toBe('seed');
  });
});
