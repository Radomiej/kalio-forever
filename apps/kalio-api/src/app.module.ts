import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { envSchema } from './config/env.schema';
import { EmbeddedUiModule } from './runtime/embedded-ui.module';
import { KalioConfigModule } from './config/kalio-config.module';
import { DatabaseModule } from './database/database.module';
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

const shouldServeUi = process.env['KALIO_SERVE_UI'] === 'true';
const webRoot = resolve(
  process.env['KALIO_WEB_ROOT'] ?? resolve(__dirname, '../../../apps/kalio-web/dist'),
);
const embeddedUiModule = shouldServeUi && existsSync(resolve(webRoot, 'index.html'))
  ? [
      ServeStaticModule.forRoot({
        rootPath: webRoot,
        renderPath: /^\/(?!api(?:\/|$)|health(?:\/|$)|socket\.io(?:\/|$))(?!.*\.[^/]+$).*/,
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
    HitlModule,
    RelayModule,
  ],
})
export class AppModule {}
