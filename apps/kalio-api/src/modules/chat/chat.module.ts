import { Module, OnModuleInit } from '@nestjs/common';
import { TextDeltaHandler } from './handlers/text-delta.handler';
import { ThinkingDeltaHandler } from './handlers/thinking-delta.handler';
import { ToolCallHandler } from './handlers/tool-call.handler';
import { DoneHandler } from './handlers/done.handler';
import { ToolArgProgressHandler } from './handlers/tool-arg-progress.handler';
import { abortCheckMiddleware } from './middleware/abort-check.middleware';
import { errorBoundaryMiddleware } from './middleware/error-boundary.middleware';
import { metricsMiddleware } from './middleware/metrics.middleware';
import { StreamProcessorService } from './stream-processor.service';
import { ToolConfirmationService } from './tool-confirmation.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { SessionManagerService } from './session-manager.service';
import { ContextAssemblyService } from './context-assembly.service';
import { ContextPreviewService } from './context-preview.service';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { SessionPipelineService } from './session-pipeline.service';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { ChatTestSupportController } from './chat-test-support.controller';
import { ChatTestSupportRaAppController } from './chat-test-support-raapp.controller';
import { AuditService } from './audit.service';
import { AuditLogController } from './audit-log.controller';
import { DrizzleMessageRepository } from './drizzle-message.repository';
import { LLMServiceAdapter } from './llm-service.adapter';
import { ImageHydratorService } from './image-hydrator.service';
import { SubagentRuntimeService } from './subagent-runtime.service';
import { ChatTestSupportService } from './chat-test-support.service';
import { RunJournalService } from './run-journal.service';
import { LLMModule } from '../llm/llm.module';
import { PersonaModule } from '../persona/persona.module';
import { ToolModule } from '../tool/tool.module';
import { VFSModule } from '../vfs/vfs.module';
import { RAAppModule } from '../raapp/raapp.module';
import { MCPModule } from '../mcp/mcp.module';
import { SkillsModule } from '../skills/skills.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { RelayModule } from '../relay/relay.module';
import { HitlModule } from '../hitl/hitl.module';
import { HitlNotificationService } from '../hitl/hitl-notification.service';
import { TelegramRelayService } from '../relay/telegram/telegram-relay.service';
import { TOOL_DISPATCH_REGISTRY, type ToolDispatchRegistryPort } from '../tool/tool-dispatch-registry.port';
import { SUBAGENT_RUNTIME } from '../tool/subagent-runtime.port';
import {
  CHUNK_HANDLERS,
  STREAM_MIDDLEWARES,
  TOOL_REGISTRY,
  LLM_SOURCE,
  MESSAGE_REPOSITORY,
} from './chat.tokens';

/**
 * Fully wired chat module.
 *
 * Middleware execution order (outermost → innermost):
 *   abortCheck → errorBoundary → metrics → handler
 *
 * Integration points:
 *   LLM_SOURCE        → LLMServiceAdapter (wraps LLMModule)
 *   MESSAGE_REPOSITORY → DrizzleMessageRepository (uses global DrizzleService)
 *   TOOL_REGISTRY     → Tool dispatch registry port exported by ToolModule
 */
@Module({
  imports: [LLMModule, PersonaModule, ToolModule, VFSModule, RAAppModule, MCPModule, SkillsModule, CredentialsModule, HitlModule, RelayModule],
  controllers: [SessionsController, AuditLogController, ChatTestSupportController, ChatTestSupportRaAppController],
  providers: [
    // Handlers
    TextDeltaHandler,
    ThinkingDeltaHandler,
    ToolCallHandler,
    DoneHandler,
    ToolArgProgressHandler,

    // Services
    StreamProcessorService,
    ToolConfirmationService,
    ToolDispatchService,
    SessionManagerService,
    ContextAssemblyService,
    ContextPreviewService,
    SessionsService,
    ChatTestSupportService,
    RunJournalService,
    ChatService,
    SessionPipelineService,
    ChatGateway,
    AuditService,
    DrizzleMessageRepository,
    LLMServiceAdapter,
    ImageHydratorService,
    SubagentRuntimeService,

    // CHUNK_HANDLERS: ordered array injected into StreamProcessorService
    {
      provide: CHUNK_HANDLERS,
      useFactory: (
        textDelta: TextDeltaHandler,
        thinkingDelta: ThinkingDeltaHandler,
        toolCall: ToolCallHandler,
        done: DoneHandler,
        toolArgProgress: ToolArgProgressHandler,
      ) => [textDelta, thinkingDelta, toolCall, done, toolArgProgress],
      inject: [TextDeltaHandler, ThinkingDeltaHandler, ToolCallHandler, DoneHandler, ToolArgProgressHandler],
    },

    // STREAM_MIDDLEWARES: ordered pipeline (outermost first)
    {
      provide: STREAM_MIDDLEWARES,
      useFactory: () => [abortCheckMiddleware, errorBoundaryMiddleware, metricsMiddleware],
    },

    // TOOL_REGISTRY: built from the executable tool registry port exported by ToolModule
    {
      provide: TOOL_REGISTRY,
      useFactory: (registry: ToolDispatchRegistryPort) => registry.getEntries(),
      inject: [TOOL_DISPATCH_REGISTRY],
    },

    // LLM_SOURCE: async iterable adapter over LLMService callback API
    {
      provide: LLM_SOURCE,
      useExisting: LLMServiceAdapter,
    },

    {
      provide: SUBAGENT_RUNTIME,
      useExisting: SubagentRuntimeService,
    },

    // MESSAGE_REPOSITORY: Drizzle-backed implementation
    {
      provide: MESSAGE_REPOSITORY,
      useExisting: DrizzleMessageRepository,
    },
  ],
  exports: [ChatService, ChatGateway, ToolDispatchService, SessionManagerService, ContextAssemblyService, ContextPreviewService, SessionsService, RunJournalService, SubagentRuntimeService, AuditService, SUBAGENT_RUNTIME],
})
export class ChatModule implements OnModuleInit {
  constructor(
    private readonly telegramRelay: TelegramRelayService,
    private readonly pipeline: SessionPipelineService,
    private readonly toolDispatch: ToolDispatchService,
    private readonly hitlNotifications: HitlNotificationService,
  ) {}

  onModuleInit(): void {
    this.telegramRelay.setCommandHandlers({
      stopAll: async () => {
        for (const id of this.pipeline.getActiveSessionIds()) {
          this.pipeline.stop(id);
        }
      },
      getStatus: async () => {
        const ids = this.pipeline.getActiveSessionIds();
        return ids.size === 0
          ? 'No active sessions.'
          : `Active sessions:\n${[...ids].join('\n')}`;
      },
      approveToolConfirmation: async (requestId) => this.resolveTelegramConfirmation(requestId, 'approve'),
      cancelToolConfirmation: async (requestId) => this.resolveTelegramConfirmation(requestId, 'cancel'),
      handleApprovalReply: async (text) => {
        const parsed = this.hitlNotifications.parseApprovalReply(text);
        if (parsed.decision === 'unknown' || !parsed.requestId) {
          return null;
        }
        return parsed.decision === 'approve'
          ? this.resolveTelegramConfirmation(parsed.requestId, 'approve', parsed.reason)
          : this.resolveTelegramConfirmation(parsed.requestId, 'cancel', parsed.reason);
      },
    });
  }

  private resolveTelegramConfirmation(requestId: string, decision: 'approve' | 'cancel', message?: string): string {
    const status = decision === 'approve'
      ? this.toolDispatch.resolveConfirmation(requestId, undefined, message)
      : this.toolDispatch.cancelConfirmation(requestId, undefined, message);

    if (status === 'resolved') {
      return `Approved HITL request ${requestId}.`;
    }
    if (status === 'rejected') {
      return `Cancelled HITL request ${requestId}.`;
    }
    if (status === 'session_mismatch') {
      return `HITL request ${requestId} belongs to another session.`;
    }
    return `HITL request ${requestId} is no longer pending.`;
  }
}
