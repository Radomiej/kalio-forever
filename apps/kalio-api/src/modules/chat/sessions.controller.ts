import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type { ChatSession, ChatMessage, CreateSessionDto } from '@kalio/types';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  list(): Promise<ChatSession[]> {
    return this.sessions.list();
  }

  @Post()
  create(@Body() dto: CreateSessionDto): Promise<ChatSession> {
    return this.sessions.create(dto);
  }

  @Get(':id/messages')
  getMessages(@Param('id') id: string): Promise<ChatMessage[]> {
    return this.sessions.getMessages(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<void> {
    await this.sessions.delete(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { title?: string; personaId?: string },
  ): Promise<void> {
    await this.sessions.update(id, body);
  }

  @Post(':id/generate-title')
  async generateTitle(@Param('id') id: string): Promise<{ title: string }> {
    return this.sessions.generateTitle(id);
  }
}
