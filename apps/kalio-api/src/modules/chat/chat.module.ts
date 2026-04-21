import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { LLMModule } from '../llm/llm.module';
import { PersonaModule } from '../persona/persona.module';
import { ToolModule } from '../tool/tool.module';
import { CredentialsModule } from '../credentials/credentials.module';

@Module({
  imports: [LLMModule, PersonaModule, ToolModule, CredentialsModule],
  controllers: [ChatController],
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
