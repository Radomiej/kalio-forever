import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { DecisionAuthGuard } from '../../common/decision-auth.guard';
import { DefaultExecutionProfileController } from './default-execution-profile.controller';
import type { DefaultExecutionProfileService } from './default-execution-profile.service';

describe('DefaultExecutionProfileController', () => {
  it('guards both selection reads and writes', () => {
    for (const method of ['get', 'select'] as const) {
      expect(Reflect.getMetadata(GUARDS_METADATA, DefaultExecutionProfileController.prototype[method])).toContain(DecisionAuthGuard);
    }
  });

  it('rejects malformed bodies without changing provider settings', () => {
    const select = vi.fn();
    const controller = new DefaultExecutionProfileController({ select } as unknown as DefaultExecutionProfileService);
    for (const input of [null, {}, { executionProfileId: 1 }, { executionProfileId: 'devin', extra: true }]) {
      expect(() => controller.select(input)).toThrow();
    }
    expect(select).not.toHaveBeenCalled();
  });
});
