import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionProfileController } from './execution-profile.controller';

describe('ExecutionProfileController Devin CLI model resolution', () => {
  const profile = {
    id: 'devin-local-swe-2-high',
    name: 'Devin · swe-2-high',
    kind: 'devin-cli-acp',
    model: 'swe-2-high',
    approvalMode: 'kalio_strict',
    enabled: true,
    capabilitiesVersion: '1',
    createdAt: 1,
    updatedAt: 1,
  } as const;

  function createController() {
    const profiles = {
      resolveDevinCli: vi.fn().mockResolvedValue(profile),
      create: vi.fn().mockResolvedValue(profile),
      get: vi.fn(),
      update: vi.fn(),
      list: vi.fn(),
    };
    const codexHost = { login: vi.fn() };
    const devinModelCatalog = {
      getCatalog: vi.fn().mockResolvedValue({
        models: ['swe-2-high'],
        status: 'ready',
        discoveredAt: 10,
        stale: false,
      }),
    };
    return { controller: new ExecutionProfileController(profiles as never, codexHost as never, devinModelCatalog as never), profiles, devinModelCatalog };
  }

  it('resolves a fresh dynamic model into its execution profile', async () => {
    const { controller, profiles } = createController();

    await expect(controller.resolveDevinCli({ model: ' swe-2-high ' })).resolves.toEqual(profile);
    expect(profiles.resolveDevinCli).toHaveBeenCalledWith('swe-2-high');
  });

  it('rejects a model that is absent from the current catalog', async () => {
    const { controller, profiles, devinModelCatalog } = createController();
    devinModelCatalog.getCatalog.mockResolvedValue({ models: ['glm-5-2'], status: 'ready', discoveredAt: 10, stale: false });

    await expect(controller.resolveDevinCli({ model: 'swe-2-high' })).rejects.toBeInstanceOf(ConflictException);
    expect(profiles.resolveDevinCli).not.toHaveBeenCalled();
  });

  it('does not resolve models from a stale or unavailable catalog', async () => {
    const { controller, profiles, devinModelCatalog } = createController();
    devinModelCatalog.getCatalog.mockResolvedValue({ models: ['swe-2-high'], status: 'command-failed', discoveredAt: 10, stale: true });

    await expect(controller.resolveDevinCli({ model: 'swe-2-high' })).rejects.toBeInstanceOf(ConflictException);
    expect(profiles.resolveDevinCli).not.toHaveBeenCalled();
  });
});
