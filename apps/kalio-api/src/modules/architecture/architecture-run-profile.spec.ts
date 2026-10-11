import { describe, expect, it, vi } from 'vitest';
import type { SessionsService } from '../chat/sessions.service';
import type { CreateSessionDto, ExecutionProfileLookupPort } from '@kalio/types';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { ArchitectureRunPreparationService } from './architecture-run-preparation.service';
import { validateArchitectureCreateRunDto } from './architecture-runtime-schema.utils';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { EXECUTION_PROFILE_LOOKUP } from '@kalio/types';
import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';
import { ExecutionProfileService } from '../agent-runtime/execution-profile.service';

const dto = { schemaId: 'strategic-decision-council', prompt: 'Review the page', executionProfileId: 'devin-swe-2' };
function fixture(parentProfile = 'devin-swe-2', unavailable = false) {
  const sessions = {
    get: vi.fn(async () => ({ id: 'host', executionProfileId: parentProfile })),
    createWithId: vi.fn(async (_id: string, _dto: CreateSessionDto) => undefined),
  };
  const profiles = { assertEnabled: vi.fn(async () => {
    if (unavailable) throw new Error('Profile unavailable');
    return { id: 'devin-swe-2' };
  }) };
  const preparation = new ArchitectureRunPreparationService(
    new ArchitectureRegistryService(), sessions as unknown as SessionsService,
    undefined, undefined, undefined, profiles as unknown as ExecutionProfileLookupPort,
  );
  return { sessions, profiles, preparation };
}

describe('architecture explicit root execution profile', () => {
  it('exports the read-only lookup bound to the existing profile service', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AgentRuntimeModule)).toContainEqual({
      provide: EXECUTION_PROFILE_LOOKUP, useExisting: ExecutionProfileService,
    });
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, AgentRuntimeModule)).toContain(EXECUTION_PROFILE_LOOKUP);
  });
  it('rejects oversized profile IDs', () => {
    expect(() => validateArchitectureCreateRunDto({ ...dto, executionProfileId: 'x'.repeat(129) })).toThrow();
  });
  it('accepts the matching persisted parent profile', async () => {
    const f = fixture();
    await f.preparation.prepareRun({ ...dto, context: { parentSessionId: 'host' } }, 'running');
    expect(f.sessions.get).toHaveBeenCalledWith('host');
    expect(f.sessions.createWithId.mock.calls[0]?.[1]).toMatchObject({ executionProfileId: 'devin-swe-2' });
  });
  it.each(['', '   ', 42, null, {}])('rejects invalid profile ID %j', value => {
    expect(() => validateArchitectureCreateRunDto({ ...dto, executionProfileId: value as string })).toThrow();
  });
  it('validates the selected profile before allocating root or branches', async () => {
    const f = fixture('devin-swe-2', true);
    await expect(f.preparation.prepareRun(dto, 'running')).rejects.toThrow('Profile unavailable');
    expect(f.sessions.createWithId).not.toHaveBeenCalled();
  });
  it('binds explicit standalone selection to root and lets children inherit', async () => {
    const f = fixture();
    await f.preparation.prepareRun(dto, 'running');
    expect(f.profiles.assertEnabled).toHaveBeenCalledWith('devin-swe-2');
    expect(f.sessions.createWithId.mock.calls[0]?.[1]).toMatchObject({ executionProfileId: 'devin-swe-2' });
    for (const call of f.sessions.createWithId.mock.calls.slice(1)) {
      expect(call[1]).not.toHaveProperty('executionProfileId');
    }
  });
  it('rejects mismatch with persisted parent instead of switching provider', async () => {
    const f = fixture('openrouter-worker');
    await expect(f.preparation.prepareRun({ ...dto, context: { parentSessionId: 'host' } }, 'running'))
      .rejects.toThrow('Architecture execution profile must match its parent session.');
    expect(f.sessions.createWithId).not.toHaveBeenCalled();
  });
  it('fails closed when explicit profile lookup is not wired', async () => {
    const f = fixture();
    const service = new ArchitectureRunPreparationService(new ArchitectureRegistryService(), f.sessions as unknown as SessionsService);
    await expect(service.prepareRun(dto, 'running')).rejects.toThrow('Architecture execution profile lookup is unavailable.');
    expect(f.sessions.createWithId).not.toHaveBeenCalled();
  });
});
