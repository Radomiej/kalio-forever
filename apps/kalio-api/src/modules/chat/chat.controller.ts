import { Controller, Get, Post, Patch, Delete, Body, Param, Query, NotFoundException, HttpCode, HttpStatus, Res, Header } from '@nestjs/common';
import type { Response } from 'express';
import type { ChatSession, CreateSessionDto, ChatMessage, VFSReadResult, VFSListResult } from '@kalio/types';
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

  @Get(':id/vfs')
  listVfs(@Param('id') id: string): VFSListResult {
    return this.vfsService.listFiles(id);
  }

  @Get(':id/vfs/read')
  readVfs(@Param('id') id: string, @Query('path') path: string): VFSReadResult {
    return this.vfsService.readFile(id, path);
  }

  @Get(':id/vfs/download')
  @Header('Content-Type', 'application/octet-stream')
  async downloadVfs(
    @Param('id') id: string,
    @Query('path') path: string,
    @Res() res: Response,
  ): Promise<void> {
    const session = await this.chatService.getSession(id);
    if (!session) throw new NotFoundException('Session not found');
    try {
      const { stream, filename } = this.vfsService.downloadFile(id, path);
      const sanitizedFilename = filename.replace(/[\r\n"]/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
      stream.pipe(res);
      stream.on('error', () => {
        if (!res.headersSent) res.status(500).send('Download failed');
      });
    } catch (err) {
      const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      const status = code === 'ENOENT' || code === 'PATH_TRAVERSAL_DENIED' ? 404 : 500;
      if (!res.headersSent) {
        res.status(status).send(status === 404 ? 'File not found' : 'Download failed');
      }
    }
  }

  @Get(':id/vfs/zip')
  @Header('Content-Type', 'application/zip')
  async zipVfs(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const session = await this.chatService.getSession(id);
    if (!session) throw new NotFoundException('Session not found');
    try {
      const archive = this.vfsService.archiveSession(id);
      res.setHeader('Content-Disposition', `attachment; filename="session-${id}.zip"`);
      archive.pipe(res);
      archive.on('error', () => {
        if (!res.headersSent) res.status(500).send('Archive failed');
      });
    } catch {
      if (!res.headersSent) res.status(500).send('Archive failed');
    }
  }

  @Post(':id/vfs')
  writeVfs(
    @Param('id') id: string,
    @Body() body: { filePath: string; content: string },
  ): void {
    this.vfsService.writeFile({ sessionId: id, filePath: body.filePath, content: body.content });
  }
}
