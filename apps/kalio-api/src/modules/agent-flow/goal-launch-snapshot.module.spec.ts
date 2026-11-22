import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { expect, it, vi } from 'vitest';
import { KalioConfigService } from '../../config/kalio-config.service';
import { GOAL_LAUNCH_SCHEMA_PUBLICATION, GOAL_LAUNCH_SNAPSHOT, type GoalLaunchInitialSnapshotPort } from '../../common/goal-launch-snapshot';
import { ArchitectureRegistryService } from '../architecture/architecture-registry.service';
import { ArchitectureRegistryModule } from '../architecture/architecture-registry.module';
import { AgentFlowGoalLaunchSnapshotModule } from './goal-launch-snapshot.module';

it('resolves the real snapshot owner without importing execution modules or authorizing absent policy', async () => {
  const policy = vi.fn(async () => null);
  const module = await Test.createTestingModule({ imports: [ArchitectureRegistryModule, AgentFlowGoalLaunchSnapshotModule] })
    .overrideProvider(KalioConfigService).useValue({ getUserGoalLaunchPolicy: policy }).compile();
  try {
    const port = module.get<GoalLaunchInitialSnapshotPort>(GOAL_LAUNCH_SNAPSHOT);
    expect(await port.readForLaunch({ flowDefinitionId: 'goal_guard_delivery_loop', schemaId: 'goal-master-delivery-loop' }))
      .toEqual({ status: 'ineligible' });
    expect(policy).toHaveBeenCalledOnce();
    const registry = module.get(ArchitectureRegistryService);
    expect(module.select(ArchitectureRegistryModule).get(ArchitectureRegistryService, { strict: true })).toBe(registry);
    expect(module.get(GOAL_LAUNCH_SCHEMA_PUBLICATION)).toBeDefined();
  } finally { await module.close(); }
});
