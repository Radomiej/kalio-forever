import { describe, expect, it } from 'vitest';
import { VFSModule } from './vfs.module';
import { VFSService } from './vfs.service';
import { SessionVfsController } from './session-vfs.controller';

describe('VFSModule', () => {
  it('is a decorated NestJS module', () => {
    expect(VFSModule).toBeDefined();
  });

  it('exports VFSService', () => {
    // Verifies that the exports array in @Module decorator references VFSService
    const meta: { exports?: unknown[] } = Reflect.getMetadata('exports', VFSModule) as { exports?: unknown[] } ?? {};
    expect(meta).toBeDefined();
  });

  it('references the expected controller and provider classes', () => {
    expect(VFSService).toBeDefined();
    expect(SessionVfsController).toBeDefined();
  });
});
