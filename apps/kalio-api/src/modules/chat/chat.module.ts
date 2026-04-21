import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { LLMModule } from '../llm/llm.module';
import { PersonaModule } from '../persona/persona.module';
import { ToolModule } from '../tool/tool.module';

@Module({
  imports: [LLMModule, PersonaModule, ToolModule],
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
