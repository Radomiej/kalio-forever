import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { LLMModule } from '../llm/llm.module';
import { PersonaModule } from '../persona/persona.module';
import { SkillsModule } from '../skills/skills.module';
import { HitlConfigController } from './hitl-config.controller';
import { HitlConfigService } from './hitl-config.service';
import { HitlDecisionService } from './hitl-decision.service';
import { HitlPolicyService } from './hitl-policy.service';

@Module({
  imports: [DatabaseModule, PersonaModule, SkillsModule, LLMModule],
  controllers: [HitlConfigController],
  providers: [HitlConfigService, HitlDecisionService, HitlPolicyService],
  exports: [HitlConfigService, HitlDecisionService, HitlPolicyService],
})
export class HitlModule {}