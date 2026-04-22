import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { LLMModule } from '../llm/llm.module';
import { PersonaModule } from '../persona/persona.module';
import { ToolModule } from '../tool/tool.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { MCPModule } from '../mcp/mcp.module';
import { AgentLoopModule } from '../agentloop/agent-loop.module';
import { VFSModule } from '../vfs/vfs.module';

@Module({
  imports: [LLMModule, PersonaModule, ToolModule, CredentialsModule, MCPModule, AgentLoopModule, VFSModule],
  controllers: [ChatController],
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
