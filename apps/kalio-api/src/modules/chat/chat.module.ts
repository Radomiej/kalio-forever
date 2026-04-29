import { Module } from '@nestjs/common';
import { TextDeltaHandler } from './handlers/text-delta.handler';
import { ThinkingDeltaHandler } from './handlers/thinking-delta.handler';
import { ToolCallHandler } from './handlers/tool-call.handler';
import { DoneHandler } from './handlers/done.handler';
import { abortCheckMiddleware } from './middleware/abort-check.middleware';
import { errorBoundaryMiddleware } from './middleware/error-boundary.middleware';
import { metricsMiddleware } from './middleware/metrics.middleware';
import { StreamProcessorService } from './stream-processor.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { SessionManagerService } from './session-manager.service';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { SessionPipelineService } from './session-pipeline.service';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { AuditService } from './audit.service';
import { AuditLogController } from './audit-log.controller';
import { DrizzleMessageRepository } from './drizzle-message.repository';
import { LLMServiceAdapter } from './llm-service.adapter';
import { ImageHydratorService } from './image-hydrator.service';
import { LLMModule } from '../llm/llm.module';
import { PersonaModule } from '../persona/persona.module';
import { ToolModule } from '../tool/tool.module';
import { VFSModule } from '../vfs/vfs.module';
import { RAAppModule } from '../raapp/raapp.module';
import { ToolRegistryService } from '../tool/tool-registry.service';
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
 *   TOOL_REGISTRY     → ToolRegistryService.getEntries() (from ToolModule)
 */
@Module({
  imports: [LLMModule, PersonaModule, ToolModule, VFSModule, RAAppModule],
  controllers: [SessionsController, AuditLogController],
  providers: [
    // Handlers
    TextDeltaHandler,
    ThinkingDeltaHandler,
    ToolCallHandler,
    DoneHandler,

    // Services
    StreamProcessorService,
    ToolDispatchService,
    SessionManagerService,
    SessionsService,
    ChatService,
    SessionPipelineService,
    ChatGateway,
    AuditService,
    DrizzleMessageRepository,
    LLMServiceAdapter,
    ImageHydratorService,

    // CHUNK_HANDLERS: ordered array injected into StreamProcessorService
    {
      provide: CHUNK_HANDLERS,
      useFactory: (
        textDelta: TextDeltaHandler,
        thinkingDelta: ThinkingDeltaHandler,
        toolCall: ToolCallHandler,
        done: DoneHandler,
      ) => [textDelta, thinkingDelta, toolCall, done],
      inject: [TextDeltaHandler, ThinkingDeltaHandler, ToolCallHandler, DoneHandler],
    },

    // STREAM_MIDDLEWARES: ordered pipeline (outermost first)
    {
      provide: STREAM_MIDDLEWARES,
      useFactory: () => [abortCheckMiddleware, errorBoundaryMiddleware, metricsMiddleware],
    },

    // TOOL_REGISTRY: built from ToolRegistryService (reads @Tool() metadata)
    {
      provide: TOOL_REGISTRY,
      useFactory: (registry: ToolRegistryService) => registry.getEntries(),
      inject: [ToolRegistryService],
    },

    // LLM_SOURCE: async iterable adapter over LLMService callback API
    {
      provide: LLM_SOURCE,
      useExisting: LLMServiceAdapter,
    },

    // MESSAGE_REPOSITORY: Drizzle-backed implementation
    {
      provide: MESSAGE_REPOSITORY,
      useExisting: DrizzleMessageRepository,
    },
  ],
  exports: [ChatService, ChatGateway, ToolDispatchService, SessionManagerService, SessionsService],
})
export class ChatModule {}
