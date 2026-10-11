import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { CLIAgentModule } from '../cli-agent/cli-agent.module';
import { VFSModule } from '../vfs/vfs.module';
import { ArchitectureRegistryController } from './architecture-registry.controller';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { ARCHITECTURE_ROLE_EXECUTOR, ArchitectureRoleExecutorService } from './architecture-role-executor';
import { ArchitectureRunsController } from './architecture-runs.controller';
import { ArchitectureRuntimeService } from './architecture-runtime.service';
import { ArchitectureRunPreparationService } from './architecture-run-preparation.service';
import { ArchitectureRuntimeAuditWriterService } from './architecture-runtime-audit.service';
import { ArchitectureRuntimeAuditRecoveryService } from './architecture-runtime-audit-recovery.service';
import { ArchitectureRuntimeChatProjectionService } from './architecture-runtime-chat-projection.service';
import { ArchitectureRuntimeGraphProjectionService } from './architecture-runtime-graph-projection.service';
import { ARCHITECTURE_RUNTIME_STOP } from '../chat/architecture-runtime-stop.port';
import { JevDecisionsClient } from '../../common/jev-decisions.client';
import { ArchitectureAutoRoutingService } from './architecture-auto-routing.service';
import { ArchitectureGoalRepository } from './architecture-goal.repository';
import { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import { ArchitectureGoalLifecycleService } from './architecture-goal-lifecycle.service';
import { PersistedGoalSourceReader } from '../chat/persisted-goal-source-reader';
import { ArchitectureGoalRunAdmissionService } from './architecture-goal-run-admission.service';
import { ArchitectureGoalRunResumeService } from './architecture-goal-run-resume.service';
import { ArchitectureGoalReviewService } from './architecture-goal-review.service';
import { ArchitectureGoalProjectionService } from './architecture-goal-projection.service';
import { ArchitectureGoalProposalService } from './architecture-goal-proposal.service';
import { ArchitectureGoalGraphAdapterService } from './architecture-goal-graph-adapter.service';
import { ArchitectureGoalReceiptProducer } from './architecture-goal-receipt-producer';
import { createGoalReceiptScopeReader } from './architecture-goal-receipt-scope';
import { ToolModule } from '../tool/tool.module';
import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';
import { ToolRegistryService } from '../tool/tool-registry.service';
import { ExecutionProfileService } from '../agent-runtime/execution-profile.service';
import { SessionsService } from '../chat/sessions.service';
import { ProjectsService } from '../chat/projects.service';
import { AuditService } from '../chat/audit.service';
import { VFSService } from '../vfs/vfs.service';
import { CHAT_DURABLE_EVIDENCE_READER, type ChatDurableEvidenceReaderPort } from '@kalio/types';

@Module({
  imports: [ChatModule, VFSModule, CLIAgentModule, ToolModule, AgentRuntimeModule],
  controllers: [ArchitectureRegistryController, ArchitectureRunsController],
  providers: [
    JevDecisionsClient,
    ArchitectureAutoRoutingService,
    ArchitectureGoalRepository,
    ArchitectureGoalAuditService,
    ArchitectureGoalReviewService,
    {
      provide: ArchitectureGoalReceiptProducer,
      inject: [ArchitectureGoalRepository, AuditService, CHAT_DURABLE_EVIDENCE_READER,
        PersistedGoalSourceReader, ToolRegistryService, SessionsService, ProjectsService, ExecutionProfileService, VFSService],
      useFactory: (repository: ArchitectureGoalRepository, audit: AuditService, durableReader: ChatDurableEvidenceReaderPort,
        sourceReader: PersistedGoalSourceReader, registry: ToolRegistryService, sessions: SessionsService,
        projects: ProjectsService, profiles: ExecutionProfileService, vfs: VFSService) =>
        new ArchitectureGoalReceiptProducer({ repository, audit, durableReader, sourceReader,
          persistedScope: createGoalReceiptScopeReader({ sessions, projects, profiles, vfs }),
          registry: { snapshot: () => registry.getEntries().map(entry => ({ canonicalName: entry.meta.name,
            target: { kind: 'kalio_registry' as const, entryIdentity: entry, executorIdentity: entry.execute,
              requiresConfirmation: Boolean(entry.meta.requiresConfirmation) } })) },
        }),
    },
    {
      provide: ArchitectureGoalGraphAdapterService,
      inject: [ArchitectureGoalLifecycleService, ArchitectureGoalRepository, ArchitectureGoalAuditService,
        ArchitectureGoalProposalService, ArchitectureGoalProjectionService],
      useFactory: (lifecycle: ArchitectureGoalLifecycleService, repository: ArchitectureGoalRepository,
        audit: ArchitectureGoalAuditService, proposals: ArchitectureGoalProposalService,
        projections: ArchitectureGoalProjectionService) =>
        new ArchitectureGoalGraphAdapterService(lifecycle, repository, audit, proposals, projections),
    },
    {
      provide: ArchitectureGoalProposalService,
      inject: [ArchitectureGoalLifecycleService, ArchitectureGoalRepository, ArchitectureGoalAuditService],
      useFactory: (lifecycle: ArchitectureGoalLifecycleService, repository: ArchitectureGoalRepository,
        audit: ArchitectureGoalAuditService) => new ArchitectureGoalProposalService(lifecycle, repository, audit),
    },
    {
      provide: ArchitectureGoalProjectionService,
      inject: [ArchitectureGoalLifecycleService, ArchitectureGoalRepository, ArchitectureGoalAuditService, ArchitectureGoalReviewService],
      useFactory: (lifecycle: ArchitectureGoalLifecycleService, repository: ArchitectureGoalRepository,
        audit: ArchitectureGoalAuditService, review: ArchitectureGoalReviewService) =>
        new ArchitectureGoalProjectionService(lifecycle, repository, audit, review),
    },
    {
      provide: ArchitectureGoalRunResumeService,
      inject: [ArchitectureGoalLifecycleService, ArchitectureGoalAuditService],
      useFactory: (lifecycle: ArchitectureGoalLifecycleService, audit: ArchitectureGoalAuditService) =>
        new ArchitectureGoalRunResumeService(lifecycle, audit),
    },
    {
      provide: ArchitectureGoalRunAdmissionService,
      inject: [ArchitectureGoalLifecycleService, ArchitectureGoalAuditService],
      useFactory: (lifecycle: ArchitectureGoalLifecycleService, audit: ArchitectureGoalAuditService) =>
        new ArchitectureGoalRunAdmissionService(lifecycle, audit),
    },
    {
      provide: ArchitectureGoalLifecycleService,
      inject: [ArchitectureGoalRepository, PersistedGoalSourceReader],
      useFactory: (repository: ArchitectureGoalRepository, sources: PersistedGoalSourceReader) =>
        new ArchitectureGoalLifecycleService(repository, sources),
    },
    ArchitectureRegistryService,
    ArchitectureRunPreparationService,
    ArchitectureRuntimeAuditWriterService,
    ArchitectureRuntimeAuditRecoveryService,
    ArchitectureRuntimeChatProjectionService,
    ArchitectureRuntimeGraphProjectionService,
    ArchitectureRuntimeService,
    {
      provide: ARCHITECTURE_RUNTIME_STOP,
      useExisting: ArchitectureRuntimeService,
    },
    {
      provide: ARCHITECTURE_ROLE_EXECUTOR,
      useClass: ArchitectureRoleExecutorService,
    },
  ],
  exports: [ArchitectureRegistryService, ArchitectureRuntimeService],
})
export class ArchitectureModule {}
