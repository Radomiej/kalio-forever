import { describe, expect, it, vi } from 'vitest';
import type { SessionsService } from '../chat/sessions.service';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { ArchitectureRunPreparationService } from './architecture-run-preparation.service';
import type { ArchitectureGoalRunAdmissionService } from './architecture-goal-run-admission.service';

function fixture(admission?: Pick<ArchitectureGoalRunAdmissionService, 'attach'>) {
  const sessions = {
    get: vi.fn(async () => ({ id: 'host' })),
    createWithId: vi.fn(async () => undefined),
  };
  return new ArchitectureRunPreparationService(
    new ArchitectureRegistryService(), sessions as unknown as SessionsService,
    undefined, undefined, admission,
  );
}

describe('goal-enabled architecture preparation', () => {
  it('awaits admission before exposing the prepared run', async () => {
    let acknowledge!: () => void;
    const attach = vi.fn(() => new Promise<void>(resolve => { acknowledge = resolve; }));
    let ready = false;
    const preparing = fixture({ attach }).prepareRun({
      schemaId: 'strategic-decision-council', prompt: 'Task', context: { goalProtocol: 1 },
    }, 'running').then(result => { ready = true; return result; });
    await vi.waitFor(() => expect(attach).toHaveBeenCalledOnce());
    expect(ready).toBe(false);
    acknowledge();
    await preparing;
    expect(ready).toBe(true);
  });

  it('propagates admission failure instead of returning a runnable execution', async () => {
    const attach = vi.fn(async () => { throw new Error('GOAL_ADMISSION_FAILED'); });
    await expect(fixture({ attach }).prepareRun({
      schemaId: 'strategic-decision-council', prompt: 'Task', context: { goalProtocol: 1 },
    }, 'running')).rejects.toThrow('GOAL_ADMISSION_FAILED');
  });
  it('rejects goal-enabled execution when durable admission is unavailable', async () => {
    await expect(fixture().prepareRun({
      schemaId: 'strategic-decision-council', prompt: 'Model-supplied task',
      context: { goalProtocol: 1, parentSessionId: 'host', promptMessageId: 'prompt', parentTurnId: 'turn' },
    }, 'running')).rejects.toThrow('GOAL_ADMISSION_UNAVAILABLE');
  });

  it('preserves marker-free legacy preparation', async () => {
    const prepared = await fixture().prepareRun({
      schemaId: 'strategic-decision-council', prompt: 'Legacy task',
    }, 'running');
    expect(prepared.run.prompt).toBe('Legacy task');
    expect(prepared.run.goalPacket).toBeUndefined();
  });
});
