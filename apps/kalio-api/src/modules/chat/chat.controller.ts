import { Controller, Get, Post, Patch, Delete, Body, Param, NotFoundException, BadRequestException, HttpCode, HttpStatus, Query } from '@nestjs/common';
import type { ChatSession, CreateSessionDto, ChatMessage, VFSListResult, VFSReadResult } from '@kalio/types';
import { ChatService } from './chat.service';
import { VFSService } from '../vfs/vfs.service';

@Controller('sessions')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly vfsService: VFSService,
  ) {}

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

  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Body() body: { title: string },
  ): Promise<ChatSession> {
    await this.chatService.renameSession(id, body.title);
    const session = await this.chatService.getSession(id);
    if (!session) throw new NotFoundException('Session not found');
    return {
      id: session.id,
      personaId: session.personaId,
      title: session.title ?? '',
      createdAt: session.createdAt instanceof Date ? session.createdAt.getTime() : session.createdAt,
      updatedAt: session.updatedAt instanceof Date ? session.updatedAt.getTime() : session.updatedAt,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.chatService.deleteSession(id);
  }

  @Post(':id/generate-title')
  async generateTitle(@Param('id') id: string): Promise<{ title: string }> {
    const title = await this.chatService.generateTitle(id);
    return { title };
  }

  // ─── VFS (session-scoped virtual filesystem) ───────────────────────────────

  @Get(':id/vfs')
  getVFSFiles(@Param('id') id: string): VFSListResult {
    return this.vfsService.listFiles(id);
  }

  @Post(':id/vfs')
  writeVFSFile(
    @Param('id') id: string,
    @Body() body: { filePath: string; content: string },
  ): { ok: boolean } {
    try {
      this.vfsService.writeFile({ conversationId: id, filePath: body.filePath, content: body.content });
      return { ok: true };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'PATH_TRAVERSAL_DENIED') throw new BadRequestException('PATH_TRAVERSAL_DENIED');
      throw err;
    }
  }

  @Get(':id/vfs/read')
  readVFSFile(
    @Param('id') id: string,
    @Query('path') filePath: string,
  ): VFSReadResult {
    try {
      return this.vfsService.readFile(id, filePath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'PATH_TRAVERSAL_DENIED') throw new BadRequestException('PATH_TRAVERSAL_DENIED');
      throw err;
    }
  }
}
