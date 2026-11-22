import { Module } from '@nestjs/common';
import { KalioConfigModule } from '../../config/kalio-config.module';
import { KalioConfigService } from '../../config/kalio-config.service';
import { GOAL_LAUNCH_SCHEMA_PUBLICATION, GOAL_LAUNCH_SNAPSHOT, GOAL_LAUNCH_SNAPSHOT_OWNERS,
  GoalLaunchSnapshotAdapter, type GoalLaunchSchemaPublicationPort, type GoalLaunchSnapshotOwners } from '../../common/goal-launch-snapshot';
import { ArchitectureRegistryModule } from '../architecture/architecture-registry.module';
import { publishSchemaAliasFlow } from './agent-flow-schema-alias';

/** Publications only: no runtime, child allocation or approval authority. */
@Module({
  imports: [ArchitectureRegistryModule, KalioConfigModule],
  providers: [{
    provide: GOAL_LAUNCH_SNAPSHOT_OWNERS,
    inject: [GOAL_LAUNCH_SCHEMA_PUBLICATION, KalioConfigService],
    useFactory: (schemas: GoalLaunchSchemaPublicationPort, config: KalioConfigService): GoalLaunchSnapshotOwners => ({
      readSchemaPublication: id => schemas.readSchemaPublication(id),
      publishAlias: (flow, schema, hash) => publishSchemaAliasFlow(flow, schema, hash).publication,
      readUserPolicy: signal => config.getUserGoalLaunchPolicy(signal),
    }),
  }, {
    provide: GOAL_LAUNCH_SNAPSHOT,
    inject: [GOAL_LAUNCH_SNAPSHOT_OWNERS],
    useFactory: (owners: GoalLaunchSnapshotOwners) => new GoalLaunchSnapshotAdapter(owners),
  }],
  exports: [GOAL_LAUNCH_SNAPSHOT],
})
export class AgentFlowGoalLaunchSnapshotModule {}
