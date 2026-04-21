import { Controller, Get, Post, Body, Param, NotFoundException } from '@nestjs/common';
import type { ChatSession, CreateSessionDto, ChatMessage } from '@kalio/types';
import { ChatService } from './chat.service';

@Controller('sessions')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  async findAll(): Promise<ChatSession[]> {
    const rows = await this.chatService.getSessions();
    return rows.map((s) => ({
      id: s.id,
      personaId: s.personaId,
      title: s.title ?? '',
      createdAt: s.createdAt instanceof Date ? s.createdAt.getTime() : s.createdAt,
      updatedAt: s.updatedAt instanceof Date ? s.updatedAt.getTime() : s.updatedAt,
    }));
  }

  @Post()
  async create(@Body() dto: CreateSessionDto): Promise<ChatSession> {
    const id = await this.chatService.createSession(dto.personaId ?? 'default', dto.title);
    const session = await this.chatService.getSession(id);
    if (!session) throw new NotFoundException('Session not found after creation');
    return {
      id: session.id,
      personaId: session.personaId,
      title: session.title ?? '',
      createdAt: session.createdAt instanceof Date ? session.createdAt.getTime() : session.createdAt,
      updatedAt: session.updatedAt instanceof Date ? session.updatedAt.getTime() : session.updatedAt,
    };
  }

  @Get(':id/messages')
  async getMessages(@Param('id') id: string): Promise<ChatMessage[]> {
    return this.chatService.getMessages(id);
  }
}
