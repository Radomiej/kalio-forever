import { describe, expect, it, vi } from 'vitest';
import { ArchitectureRunsController } from './architecture-runs.controller';
import type { ArchitectureRuntimeService } from './architecture-runtime.service';
import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ArchitectureModule } from './architecture.module';
import { ChatModule } from '../chat/chat.module';
import { SessionEventsService } from '../chat/session-events.service';
import { ARCHITECTURE_RUNTIME_EVENTS, type ArchitectureRuntimeEmit } from './architecture-runtime-events.port';
import { ArchitectureRuntimeService as RuntimeToken } from './architecture-runtime.service';

describe('REST architecture event publisher', () => {
  it('forwards the exact publisher on both create paths, leaving stop unchanged', async () => {
    const runtime = { createRun: vi.fn(), createRunAsync: vi.fn(), stopRun: vi.fn() };
    const publish = vi.fn();
    const controller = new ArchitectureRunsController(runtime as unknown as ArchitectureRuntimeService, publish);
    const dto = { schemaId: 'coding_review', prompt: 'test' };
    await controller.create(dto);
    await controller.createAsync(dto);
    await controller.stop('run');
    expect(runtime.createRun).toHaveBeenCalledExactlyOnceWith(dto, publish);
    expect(runtime.createRunAsync).toHaveBeenCalledExactlyOnceWith(dto, publish);
    expect(runtime.stopRun).toHaveBeenCalledExactlyOnceWith('run');
  });

  it('requires DI and binds the composition factory to the existing exported bus singleton', async () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ArchitectureModule) as unknown[];
    const provider = providers.find((value) => typeof value === 'object' && value !== null
      && 'provide' in value && value.provide === ARCHITECTURE_RUNTIME_EVENTS) as {
        provide: symbol; inject: [typeof SessionEventsService];
        useFactory: (bus: SessionEventsService) => ArchitectureRuntimeEmit;
      };
    expect(provider.inject).toEqual([SessionEventsService]);
    expect(providers).not.toContain(SessionEventsService);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, ChatModule)).toContain(SessionEventsService);
    const bus = new SessionEventsService();
    const listener = vi.fn();
    bus.onRuntimeEvent(listener);
    const runtime = { createRunAsync: vi.fn(async (_dto, emit: ArchitectureRuntimeEmit) => {
      emit('tool:confirmation_invalidated', { sessionId: 'child', requestId: 'request', reason: 'cancelled' });
    }) };
    const module = await Test.createTestingModule({ providers: [ArchitectureRunsController,
      { provide: RuntimeToken, useValue: runtime }, { provide: SessionEventsService, useValue: bus }, provider,
    ] }).compile();
    await module.get(ArchitectureRunsController).createAsync({ schemaId: 'coding_review', prompt: 'test' });
    expect(runtime.createRunAsync.mock.calls[0][1]).toBe(bus.emitRuntimeEvent);
    expect(listener).toHaveBeenCalledExactlyOnceWith('tool:confirmation_invalidated', {
      sessionId: 'child', requestId: 'request', reason: 'cancelled',
    });
    await module.close();
    await expect(Test.createTestingModule({ providers: [ArchitectureRunsController,
      { provide: RuntimeToken, useValue: runtime },
    ] }).compile()).rejects.toThrow();
  });
});
