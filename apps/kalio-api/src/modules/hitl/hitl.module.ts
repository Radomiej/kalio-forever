import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { LLMModule } from '../llm/llm.module';
import { PersonaModule } from '../persona/persona.module';
import { SkillsModule } from '../skills/skills.module';
import { RelayModule } from '../relay/relay.module';
import { HitlConfigController } from './hitl-config.controller';
import { HitlConfigService } from './hitl-config.service';
import { HitlDecisionService } from './hitl-decision.service';
import { HitlNotificationService } from './hitl-notification.service';
import { HitlPolicyService } from './hitl-policy.service';
import { SecurityPolicyController } from './security-policy.controller';
import { SecurityPolicyService } from './security-policy.service';
import { HitlRequestService } from './hitl-request.service';
import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';

@Module({
  imports: [DatabaseModule, AgentRuntimeModule, PersonaModule, SkillsModule, LLMModule, RelayModule],
  controllers: [HitlConfigController, SecurityPolicyController],
  providers: [HitlConfigService, HitlDecisionService, HitlNotificationService, HitlPolicyService, SecurityPolicyService, HitlRequestService],
  exports: [HitlConfigService, HitlDecisionService, HitlNotificationService, HitlPolicyService, SecurityPolicyService, HitlRequestService],
})
export class HitlModule {}
