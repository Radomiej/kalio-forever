import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ContextController } from './context.controller';

function makeContextPreviewService() {
  return {
    buildPreview: vi.fn().mockResolvedValue({
      sessionId: 'runtime-preview',
      personaId: 'persona-1',
      model: 'test-model',
      contextLimit: 32000,
      estimatedTokens: {
        total: 1,
        systemPrompt: 1,
        tools: 0,
        history: 0,
        images: 0,
        reasoning: 0,
      },
      compaction: {
        applied: false,
        unboundedMessageCount: 1,
        finalMessageCount: 1,
        safeTargetTokens: 25600,
      },
      effectiveSystemPrompt: 'system',
      tools: [],
      messages: [],
      runtimeKind: 'chat',
      runtimeProfileSource: 'request',
    }),
  };
}

describe('ContextController', () => {
  it('delegates session previews with the provided sessionId', async () => {
    const contextPreview = makeContextPreviewService();
    const controller = new ContextController(contextPreview as never);

    await controller.preview({
      target: 'session',
      sessionId: 'sess-1',
      personaId: 'persona-1',
    });

    expect(contextPreview.buildPreview).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        target: 'session',
        sessionId: 'sess-1',
      }),
    );
  });

  it('accepts runtime previews without a sessionId', async () => {
    const contextPreview = makeContextPreviewService();
    const controller = new ContextController(contextPreview as never);

    await controller.preview({
      target: 'runtime',
      personaId: 'persona-1',
      runtimeContext: {
        runtimeKind: 'chat',
        systemPromptProfile: 'default-chat',
      },
    });

    expect(contextPreview.buildPreview).toHaveBeenCalledWith(
      'runtime-preview',
      expect.objectContaining({
        target: 'runtime',
        personaId: 'persona-1',
      }),
    );
  });

  it('still rejects session previews without sessionId', async () => {
    const contextPreview = makeContextPreviewService();
    const controller = new ContextController(contextPreview as never);

    await expect(controller.preview({
      target: 'session',
      personaId: 'persona-1',
    } as never)).rejects.toBeInstanceOf(BadRequestException);
  });
});
