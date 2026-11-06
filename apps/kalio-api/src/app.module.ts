import { Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'fs';
import { Request, Response } from 'express';
import { resolve } from 'path';
import { envSchema } from './config/env.schema';
import { EmbeddedUiModule } from './runtime/embedded-ui.module';
import { KalioConfigModule } from './config/kalio-config.module';
import { DatabaseModule } from './database/database.module';
import { DecisionSettingsModule } from './common/decision-settings.module';
import { LLMModule } from './modules/llm/llm.module';
import { PersonaModule } from './modules/persona/persona.module';
import { ToolModule } from './modules/tool/tool.module';
import { VFSModule } from './modules/vfs/vfs.module';
import { MCPModule } from './modules/mcp/mcp.module';
import { RAAppModule } from './modules/raapp/raapp.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { SkillsModule } from './modules/skills/skills.module';
import { MemoryModule } from './modules/memory/memory.module';
import { AllowedPathsModule } from './modules/allowed-paths/allowed-paths.module';
import { ChatModule } from './modules/chat/chat.module';
import { SearchModule } from './modules/search/search.module';
import { CLIAgentModule } from './modules/cli-agent/cli-agent.module';
import { ImageModule } from './modules/image/image.module';
import { RelayModule } from './modules/relay/relay.module';
import { HitlModule } from './modules/hitl/hitl.module';
import { ArchitectureModule } from './modules/architecture/architecture.module';
import { AgentFlowModule } from './modules/agent-flow/agent-flow.module';
import { AgentRuntimeModule } from './modules/agent-runtime/agent-runtime.module';
import { CodeIntelligenceModule } from './modules/code-intelligence/code-intelligence.module';
import { KalioMcpBridgeModule } from './modules/mcp-bridge/kalio-mcp-bridge.module';
import { SpeechModule } from './modules/speech/speech.module';

const shouldServeUi = process.env['KALIO_SERVE_UI'] === 'true';
const webRoot = resolve(
  process.env['KALIO_WEB_ROOT'] ?? resolve(__dirname, '../../../apps/kalio-web/dist'),
);
const uiRenderPath = /^\/(?!api(?:\/|$)|health(?:\/|$)|socket\.io(?:\/|$))(?!.*\.[^/]+$).*/;
const embeddedUiAvailable = shouldServeUi && existsSync(resolve(webRoot, 'index.html'));
const embeddedUiModule = embeddedUiAvailable
  ? [
      ServeStaticModule.forRoot({
        rootPath: webRoot,
        // Never matches: this module's renderPath handler calls res.sendFile()
        // without a root option, so send(1) applies dotfile rules to the
        // absolute path and 404s every UI route under a hidden install root
        // (the default is ~/.local/share/kalio). AppModule.onModuleInit
        // registers the equivalent route with a root option instead.
        renderPath: /$^/,
        exclude: ['/api', '/api/*path', '/health', '/health/*path', '/socket.io', '/socket.io/*path'],
        serveStaticOptions: {
          index: false,
          fallthrough: true,
          immutable: true,
          maxAge: '1y',
        },
      }),
    ]
  : [];

// Serving index.html relative to the web root keeps send(1)'s dotfile check
// on the request path, which never contains a hidden segment.
const renderEmbeddedUiIndex = (_req: Request, res: Response) => {
  res.sendFile('index.html', { root: webRoot, dotfiles: 'allow' });
};

@Module({
  imports: [
    EmbeddedUiModule,
    ...embeddedUiModule,
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validationSchema: envSchema,
      validationOptions: { abortEarly: true },
    }),
    KalioConfigModule,
    DatabaseModule,
    LLMModule,
    PersonaModule,
    CredentialsModule,
    DecisionSettingsModule,
    VFSModule,
    ToolModule,
    MCPModule,
    RAAppModule,
    SkillsModule,
    AllowedPathsModule,
    MemoryModule,
    ChatModule,
    SearchModule,
    CLIAgentModule,
    ImageModule,
    ArchitectureModule,
    AgentFlowModule,
    AgentRuntimeModule,
    CodeIntelligenceModule,
    KalioMcpBridgeModule,
    SpeechModule,
    HitlModule,
    RelayModule,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly httpAdapterHost?: HttpAdapterHost) {}

  onModuleInit() {
    if (!embeddedUiAvailable) {
      return;
    }
    // ServeStaticModule's renderPath never matches, so UI routes render here.
    // Registered after Nest's controllers, so /api/*, /health and files are
    // unaffected; the regex excludes them regardless.
    this.httpAdapterHost?.httpAdapter
      .getInstance()
      .get(uiRenderPath, renderEmbeddedUiIndex);
  }
}
