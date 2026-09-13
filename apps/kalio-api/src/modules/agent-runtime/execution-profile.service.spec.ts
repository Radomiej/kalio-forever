import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { DrizzleService } from '../../database/drizzle.service';
import type { CredentialsService } from '../credentials/credentials.service';
import { executionProfiles } from '../../database/schema';
import { ExecutionProfileService } from './execution-profile.service';

type ProfileRow = typeof executionProfiles.$inferSelect;

function makeService(initial: ProfileRow[] = [], credentials?: Partial<CredentialsService>) {
  const rows = [...initial];
  const select = vi.fn(() => ({
      from: vi.fn(() => ({
        then: (resolve: (value: ProfileRow[]) => unknown) => Promise.resolve(rows).then(resolve),
        where: vi.fn(() => ({
          then: (resolve: (value: ProfileRow[]) => unknown) => Promise.resolve(rows).then(resolve),
          limit: vi.fn(async () => rows.slice(0, 1)),
        })),
    })),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(async (row: ProfileRow) => {
      rows.push(row);
    }),
  }));
  const update = vi.fn(() => ({
    set: vi.fn((patch: Partial<ProfileRow>) => ({
      where: vi.fn(async () => {
        Object.assign(rows[0], patch);
      }),
    })),
  }));
  const drizzle = { db: { select, insert, update } } as unknown as DrizzleService;
  return { service: new ExecutionProfileService(drizzle, credentials as CredentialsService | undefined), rows, insert, update };
}

function profileRow(overrides: Partial<ProfileRow> = {}): ProfileRow {
  const now = new Date(1);
  return {
    id: 'codex-guard',
    name: 'Codex Guard',
    kind: 'codex-app-server',
    provider: null,
    model: 'gpt-5.4',
    authProfileId: 'chatgpt-default',
    reasoningEffort: null,
    approvalMode: 'codex_guard',
    enabled: true,
    capabilitiesVersion: '1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ExecutionProfileService', () => {
  it('maps persisted profiles to the shared contract', async () => {
    const { service } = makeService([profileRow()]);

    await expect(service.list()).resolves.toEqual([expect.objectContaining({
      id: 'codex-guard',
      kind: 'codex-app-server',
      approvalMode: 'codex_guard',
      createdAt: 1,
      updatedAt: 1,
    })]);
  });

  it('requires a provider for direct LLM profiles', async () => {
    const { service } = makeService();

    await expect(service.create({ name: 'Direct', kind: 'direct-llm', model: '' }))
      .rejects.toThrow('require a provider');
  });

  it('does not allow a disabled profile to run', async () => {
    const { service } = makeService([profileRow({ enabled: false })]);

    await expect(service.assertEnabled('codex-guard')).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates only mutable profile fields and normalizes blanks', async () => {
    const { service, rows, update } = makeService([profileRow()]);

    await service.update('codex-guard', { name: '  Codex Strict  ', authProfileId: '  ', approvalMode: 'kalio_strict' });

    expect(update).toHaveBeenCalledTimes(1);
    expect(rows[0]?.name).toBe('Codex Strict');
    await expect(service.get('codex-guard')).resolves.toEqual(expect.objectContaining({
      name: 'Codex Strict',
      approvalMode: 'kalio_strict',
    }));
  });

  it('resolves a deterministic direct profile against one saved credential', async () => {
    const credentials = {
      getProviderConfigForCredential: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        apiKey: 'secret',
        model: 'openrouter/default',
      }),
      getModelsForCredential: vi.fn().mockResolvedValue(['openrouter/default', 'openrouter/fast']),
    };
    const { service, rows, insert } = makeService([], credentials);

    const first = await service.resolveDirect({ credentialId: 'credential-1', model: 'openrouter/fast' });
    const second = await service.resolveDirect({ credentialId: 'credential-1', model: 'openrouter/fast' });

    expect(first).toEqual(expect.objectContaining({
      kind: 'direct-llm',
      provider: 'openrouter',
      model: 'openrouter/fast',
      authProfileId: 'credential-1',
      enabled: true,
    }));
    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(credentials.getProviderConfigForCredential).toHaveBeenCalledWith('credential-1');
  });

  it('rejects a model that the selected credential does not expose', async () => {
    const credentials = {
      getProviderConfigForCredential: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        apiKey: 'secret',
        model: 'openrouter/default',
      }),
      getModelsForCredential: vi.fn().mockResolvedValue(['openrouter/default']),
    };
    const { service } = makeService([], credentials);

    await expect(service.resolveDirect({ credentialId: 'credential-1', model: 'openrouter/missing' }))
      .rejects.toThrow('not available');
  });
});
