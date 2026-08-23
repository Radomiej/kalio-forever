import { describe, expect, it, vi } from 'vitest';
import type { ExecutionProfile } from '@kalio/types';
import type { LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import { DevinApiLLMSource } from './devin-api.llm-source';
import type { DevinApiClient, DevinApiClientPort } from './devin-api.client';

const profile: ExecutionProfile = {
  id: 'devin-cloud-default',
  name: 'Devin Cloud',
  kind: 'devin-api',
  model: 'managed',
  approvalMode: 'kalio_strict',
  enabled: true,
  capabilitiesVersion: '1',
  createdAt: 1,
  updatedAt: 1,
};

function makeParams(client: DevinApiClientPort, overrides: Partial<LLMSourceParams> = {}): LLMSourceParams {
  return {
    messages: [
      { role: 'system', content: 'Keep the answer concise.' },
      { role: 'user', content: 'Inspect the issue.' },
    ] as never,
    tools: [],
    sessionId: 'kalio-session',
    messageId: 'message-1',
    executionProfile: profile,
    ...overrides,
  };
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const chunks: unknown[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('DevinApiLLMSource', () => {
  it('creates, binds, polls, deduplicates remote messages, and completes a turn', async () => {
    const client: DevinApiClientPort = {
      getIntegrationStatus: () => ({ configured: true, organizationId: 'org-1', maxAcuLimit: 2 }),
      getPollOptions: () => ({ intervalMs: 0, timeoutMs: 100 }),
      createSession: vi.fn().mockResolvedValue({ sessionId: 'devin-1', status: 'new' }),
      sendMessage: vi.fn(),
      getSession: vi.fn()
        .mockResolvedValueOnce({ sessionId: 'devin-1', status: 'running', statusDetail: 'working' })
        .mockResolvedValueOnce({ sessionId: 'devin-1', status: 'running', statusDetail: 'finished' }),
      listMessages: vi.fn().mockResolvedValue({
        items: [{ eventId: 'event-1', message: 'Devin answer.', source: 'devin' }],
        hasNextPage: false,
      }),
    };
    const bound = vi.fn(async () => undefined);
    const audit = vi.fn(async () => undefined);
    const chunks = await collect(new DevinApiLLMSource(client as DevinApiClient).stream(makeParams(client, {
      onExternalThreadBound: bound,
      onExternalAudit: audit,
    })));

    expect(chunks).toEqual([{ type: 'text_delta', delta: 'Devin answer.' }, { type: 'done' }]);
    expect(client.createSession).toHaveBeenCalledWith('USER:\nInspect the issue.');
    expect(bound).toHaveBeenCalledWith('devin-1', { processEpoch: 'devin:devin-1' });
    expect(client.listMessages).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'devin.session.completed', status: 'completed' }));
  });

  it('uses the existing remote session for a follow-up instead of creating another one', async () => {
    const client: DevinApiClientPort = {
      getIntegrationStatus: () => ({ configured: true, organizationId: 'org-1', maxAcuLimit: 2 }),
      getPollOptions: () => ({ intervalMs: 0, timeoutMs: 100 }),
      createSession: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({ sessionId: 'devin-1', status: 'running', statusDetail: 'finished' }),
      getSession: vi.fn().mockResolvedValue({ sessionId: 'devin-1', status: 'running', statusDetail: 'finished' }),
      listMessages: vi.fn().mockResolvedValue({ items: [], hasNextPage: false }),
    };

    await expect(collect(new DevinApiLLMSource(client as DevinApiClient).stream(makeParams(client, {
      externalThreadId: 'devin-1',
    })))).resolves.toEqual([{ type: 'done' }]);
    expect(client.createSession).not.toHaveBeenCalled();
    expect(client.sendMessage).toHaveBeenCalledWith('devin-1', 'Inspect the issue.');
  });

  it('omits Kalio tool schemas and records the boundary instead of forwarding them', async () => {
    const audit = vi.fn(async () => undefined);
    const client = {
      getPollOptions: () => ({ intervalMs: 0, timeoutMs: 10 }),
      createSession: vi.fn().mockResolvedValue({ sessionId: 'devin-2', status: 'new' }),
      getSession: vi.fn().mockResolvedValue({ sessionId: 'devin-2', status: 'running', statusDetail: 'finished' }),
      listMessages: vi.fn().mockResolvedValue({ items: [], hasNextPage: false }),
    } as unknown as DevinApiClient;
    await expect(collect(new DevinApiLLMSource(client).stream(makeParams(client, {
      tools: [{ name: 'vfs_read', description: 'read', parameters: {}, requiresConfirmation: false }],
      onExternalAudit: audit,
    })))).resolves.toEqual([{ type: 'done' }]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'devin.tools.omitted' }));
  });
});
