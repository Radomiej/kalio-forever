import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HitlConfigController } from './hitl-config.controller';

describe('HitlConfigController', () => {
  let controller: HitlConfigController;
  let service: {
    getConfig: ReturnType<typeof vi.fn>;
    updateConfig: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      getConfig: vi.fn().mockResolvedValue({ mode: 'manual', autoPersonaId: null }),
      updateConfig: vi.fn().mockResolvedValue({ mode: 'bypass', autoPersonaId: 'reviewer-persona' }),
    };

    controller = new HitlConfigController(service as never);
  });

  it('returns the current HITL config', async () => {
    const result = await controller.getConfig();

    expect(service.getConfig).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mode: 'manual', autoPersonaId: null });
  });

  it('updates the HITL config', async () => {
    const dto = { mode: 'bypass' as const, autoPersonaId: 'reviewer-persona' };

    const result = await controller.updateConfig(dto);

    expect(service.updateConfig).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ mode: 'bypass', autoPersonaId: 'reviewer-persona' });
  });
});