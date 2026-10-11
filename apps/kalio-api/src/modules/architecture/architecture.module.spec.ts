import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { ChatModule } from '../chat/chat.module';
import { VFSModule } from '../vfs/vfs.module';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { ARCHITECTURE_ROLE_EXECUTOR, ArchitectureRoleExecutorService } from './architecture-role-executor';
import { ArchitectureRuntimeService } from './architecture-runtime.service';
import { ArchitectureModule } from './architecture.module';
import { ArchitectureGoalProjectionService } from './architecture-goal-projection.service';
import { ArchitectureGoalReviewService } from './architecture-goal-review.service';
import { ArchitectureGoalLifecycleService } from './architecture-goal-lifecycle.service';
import { ArchitectureGoalRepository } from './architecture-goal.repository';
import { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import { ArchitectureGoalProposalService } from './architecture-goal-proposal.service';
import { ArchitectureGoalReceiptProducer } from './architecture-goal-receipt-producer';
import { ToolModule } from '../tool/tool.module';
import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';
import { ToolRegistryService } from '../tool/tool-registry.service';
import { ExecutionProfileService } from '../agent-runtime/execution-profile.service';
import { SessionsService } from '../chat/sessions.service';
import { ProjectsService } from '../chat/projects.service';
import { AuditService } from '../chat/audit.service';
import { PersistedGoalSourceReader } from '../chat/persisted-goal-source-reader';
import { VFSService } from '../vfs/vfs.service';
import { CHAT_DURABLE_EVIDENCE_READER } from '@kalio/types';

describe('ArchitectureModule', () => {
  it('registers receipt production with actual exported authority dependencies', () => {
    const imports: unknown = Reflect.getMetadata(MODULE_METADATA.IMPORTS, ArchitectureModule);
    expect(imports).toContain(ToolModule);
    expect(imports).toContain(AgentRuntimeModule);
    const providers: unknown = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ArchitectureModule);
    expect(providers).toContainEqual({ provide: ArchitectureGoalReceiptProducer,
      inject: [ArchitectureGoalRepository, AuditService, CHAT_DURABLE_EVIDENCE_READER,
        PersistedGoalSourceReader, ToolRegistryService, SessionsService, ProjectsService, ExecutionProfileService, VFSService],
      useFactory: expect.any(Function) });
  });
  it('registers goal projection with the real review and durable state dependencies', () => {
    const providers: unknown = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ArchitectureModule);
    expect(providers).toContain(ArchitectureGoalReviewService);
    expect(providers).toContainEqual({
      provide: ArchitectureGoalProposalService,
      inject: [ArchitectureGoalLifecycleService, ArchitectureGoalRepository, ArchitectureGoalAuditService],
      useFactory: expect.any(Function),
    });
    expect(providers).toContainEqual({
      provide: ArchitectureGoalProjectionService,
      inject: [ArchitectureGoalLifecycleService, ArchitectureGoalRepository, ArchitectureGoalAuditService, ArchitectureGoalReviewService],
      useFactory: expect.any(Function),
    });
  });
  it('wires architecture runtime through the role executor port', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, ArchitectureModule)).toContain(ChatModule);
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, ArchitectureModule)).toContain(VFSModule);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, ArchitectureModule)).toEqual([
      ArchitectureRegistryService,
      ArchitectureRuntimeService,
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ArchitectureModule)).toContainEqual({
      provide: ARCHITECTURE_ROLE_EXECUTOR,
      useClass: ArchitectureRoleExecutorService,
    });
  });
});
