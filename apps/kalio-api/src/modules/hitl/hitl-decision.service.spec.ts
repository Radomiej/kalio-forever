import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMStreamChunk } from '@kalio/types';
import { HitlDecisionService } from './hitl-decision.service';

describe('HitlDecisionService', () => {
  let service: HitlDecisionService;
  let personaService: { getSessionConfig: ReturnType<typeof vi.fn> };
  let skillsService: { findByIds: ReturnType<typeof vi.fn> };
  let llmService: { streamChat: ReturnType<typeof vi.fn> };
  let executionProfiles: { assertEnabled: ReturnType<typeof vi.fn> };
  let codexSource: { stream: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    personaService = {
      getSessionConfig: vi.fn().mockResolvedValue({
        systemPrompt: 'Review approvals carefully.',
        model: 'mock',
        allowedTools: [],
        skillIds: [],
        mcpPolicy: 'allow_all',
        kv: {},
        executionProfileId: undefined,
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
    executionProfiles = { assertEnabled: vi.fn() };
    codexSource = {
      stream: vi.fn(async function* () {
        yield { type: 'text_delta', delta: '{"decision":"deny","risk":"high","reason":"Unsafe path."}' };
        yield { type: 'done' };
      }),
    };

    service = new HitlDecisionService(
      personaService as never,
      skillsService as never,
      llmService as never,
      executionProfiles as never,
      codexSource as never,
    );
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

  it('parses structured decision and risk fields from the evaluator', async () => {
    llmService.streamChat.mockImplementationOnce(async (_messages, _tools, options) => {
      options.onChunk({
        delta: '{"decision":"deny","risk":"critical","reason":"Destructive operation."}',
        done: false,
        thinking: false,
        sessionId: options.sessionId,
        messageId: options.messageId,
      } satisfies LLMStreamChunk);
      return [];
    });

    await expect(service.evaluateApproval({
      personaId: 'reviewer-persona',
      request: { kind: 'tool', sessionId: 'sess-1', name: 'terminal_exec', args: {} } as never,
    })).resolves.toEqual({ agree: false, decision: 'deny', risk: 'critical', reason: 'Destructive operation.' });
  });

  it('uses the persona-bound Codex profile for a fresh no-tools security review', async () => {
    personaService.getSessionConfig.mockResolvedValueOnce({
      systemPrompt: 'Review approvals carefully.',
      model: 'mock',
      executionProfileId: 'codex-guard',
      allowedTools: [],
      skillIds: [],
      mcpPolicy: 'allow_all',
      kv: {},
    });
    executionProfiles.assertEnabled.mockResolvedValueOnce({
      id: 'codex-guard',
      kind: 'codex-app-server',
      model: 'gpt-5.4',
      approvalMode: 'codex_guard',
      enabled: true,
      capabilitiesVersion: '1',
      name: 'Codex Guard',
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(service.evaluateApproval({
      personaId: 'reviewer-persona',
      request: { kind: 'tool', sessionId: 'sess-1', name: 'fs_write', args: {} } as never,
    })).resolves.toEqual({ agree: false, decision: 'deny', risk: 'high', reason: 'Unsafe path.' });
    expect(codexSource.stream).toHaveBeenCalledWith(expect.objectContaining({
      tools: [],
      executionProfile: expect.objectContaining({ id: 'codex-guard' }),
    }));
    expect(llmService.streamChat).not.toHaveBeenCalled();
  });
});
