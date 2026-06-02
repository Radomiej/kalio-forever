import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMStreamChunk } from '@kalio/types';
import { HitlDecisionService } from './hitl-decision.service';

describe('HitlDecisionService', () => {
  let service: HitlDecisionService;
  let personaService: { getSessionConfig: ReturnType<typeof vi.fn> };
  let skillsService: { findByIds: ReturnType<typeof vi.fn> };
  let llmService: { streamChat: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    personaService = {
      getSessionConfig: vi.fn().mockResolvedValue({
        systemPrompt: 'Review approvals carefully.',
        model: 'mock',
        allowedTools: [],
        skillIds: [],
        mcpPolicy: 'allow_all',
        kv: {},
      }),
    };
    skillsService = {
      findByIds: vi.fn().mockResolvedValue([]),
    };
    llmService = {
      streamChat: vi.fn().mockImplementation(async (_messages, _tools, options) => {
        options.onChunk({
          delta: '{"agree":true,"reason":"Looks safe."}',
          done: false,
          thinking: false,
          sessionId: options.sessionId,
          messageId: options.messageId,
        } satisfies LLMStreamChunk);
        return [];
      }),
    };

    service = new HitlDecisionService(personaService as never, skillsService as never, llmService as never);
  });

  it('passes request abortSignal through to the LLM evaluator call', async () => {
    const abortController = new AbortController();

    await service.evaluateApproval({
      personaId: 'reviewer-persona',
      request: {
        kind: 'tool',
        sessionId: 'sess-1',
        name: 'dangerous_tool',
        args: { path: 'demo.txt' },
        abortSignal: abortController.signal,
      } as never,
    });

    expect(llmService.streamChat).toHaveBeenCalledWith(
      expect.any(Array),
      [],
      expect.objectContaining({ abortSignal: abortController.signal }),
    );
  });
});