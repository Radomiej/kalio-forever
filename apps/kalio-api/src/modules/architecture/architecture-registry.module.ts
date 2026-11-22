import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GOAL_LAUNCH_SCHEMA_PUBLICATION, type GoalLaunchSchemaPublicationPort } from '../../common/goal-launch-snapshot';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { publishArchitectureGoalSchema } from './architecture-goal-schema-publication';

/** Registry ownership is independent from chat and architecture execution. */
@Module({
  imports: [ConfigModule],
  providers: [ArchitectureRegistryService, {
    provide: GOAL_LAUNCH_SCHEMA_PUBLICATION,
    inject: [ArchitectureRegistryService],
    useFactory: (registry: ArchitectureRegistryService): GoalLaunchSchemaPublicationPort => ({
      readSchemaPublication: schemaId => {
        const schema = registry.findOne(schemaId);
        return schema ? publishArchitectureGoalSchema(schema).publication : null;
      },
    }),
  }],
  exports: [ArchitectureRegistryService, GOAL_LAUNCH_SCHEMA_PUBLICATION],
})
export class ArchitectureRegistryModule {}
