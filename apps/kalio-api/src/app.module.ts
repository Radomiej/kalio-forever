import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { LLMModule } from './modules/llm/llm.module';
import { ChatModule } from './modules/chat/chat.module';
import { PersonaModule } from './modules/persona/persona.module';
import { ToolModule } from './modules/tool/tool.module';
import { VFSModule } from './modules/vfs/vfs.module';
import { MCPModule } from './modules/mcp/mcp.module';
import { RAAppModule } from './modules/raapp/raapp.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { SkillsModule } from './modules/skills/skills.module';
import { AgentLoopModule } from './modules/agentloop/agent-loop.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
      validationOptions: { abortEarly: true },
    }),
    DatabaseModule,
    LLMModule,
    PersonaModule,
    CredentialsModule,
    VFSModule,
    ToolModule,
    MCPModule,
    RAAppModule,
    SkillsModule,
    AgentLoopModule,
    ChatModule,
  ],
})
export class AppModule {}
