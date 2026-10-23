import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerLLMSource } from './codex-app-server.llm-source';
import type { LLMSourceParams } from '../chat/interfaces/llm-source.interface';

describe('Codex model admission before thread creation', () => {
  it('admits the exact discovered model through to thread creation', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'model/list') return { data: [{ model: 'gpt-6-luna' }] };
      throw new Error('admitted-thread-boundary');
    });
    const source = new CodexAppServerLLMSource({ getConnection: vi.fn().mockResolvedValue({ request }) } as never);
    const params: LLMSourceParams = {
      messages: [], tools: [], sessionId: 'session', messageId: 'message',
      executionProfile: { id: 'codex', name: 'Codex', kind: 'codex-app-server', model: 'gpt-6-luna',
        enabled: true, approvalMode: 'kalio_strict', capabilitiesVersion: '1', createdAt: 1, updatedAt: 1 },
    };
    await expect(source.stream(params).next()).rejects.toThrow('admitted-thread-boundary');
    expect(request.mock.calls.map(([method]) => method)).toEqual(['model/list', 'thread/start']);
  });
  it.each([
    [{ data: [{ model: 'gpt-6-luna' }] }, 'gpt-5.4', 'not currently available'],
    [{ data: [] }, 'gpt-6-luna', 'not currently available'],
    [{ data: [{ model: 'gpt-6-luna', hidden: true }] }, 'gpt-6-luna', 'not currently available'],
    [{ data: 'invalid' }, 'gpt-6-luna', 'model catalog'],
  ])('rejects an unavailable or unverified model without thread/start', async (catalog, model, error) => {
    const request = vi.fn(async (method: string) => {
      if (method === 'model/list') return catalog;
      throw new Error(`Unexpected request ${method}`);
    });
    const source = new CodexAppServerLLMSource({ getConnection: vi.fn().mockResolvedValue({ request }) } as never);
    const params: LLMSourceParams = {
      messages: [], tools: [], sessionId: 'session', messageId: 'message',
      executionProfile: { id: 'codex', name: 'Codex', kind: 'codex-app-server', model,
        enabled: true, approvalMode: 'kalio_strict', capabilitiesVersion: '1', createdAt: 1, updatedAt: 1 },
    };
    await expect(source.stream(params).next()).rejects.toThrow(error);
    expect(request.mock.calls.map(([method]) => method)).toEqual(['model/list']);
  });
});
