import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { nanoid } from 'nanoid';
import type { Request, Response } from 'express';
import type { ChatAttachment, VFSListResult, VFSReadResult } from '@kalio/types';
import { VFSService } from './vfs.service';

const ALLOWED_UPLOAD_MIMES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const UPLOAD_MAX_BYTES = 10 << 20; // 10 MB request body
const SERVE_PATH_MARKER = '/vfs/serve-path/';

function resolveServePath(path: string | undefined, request?: Pick<Request, 'originalUrl'>): string {
  if (typeof path === 'string' && path.length > 0) {
    return path;
  }

  const originalUrl = request?.originalUrl;
  if (!originalUrl) {
    return '';
  }

  const markerIndex = originalUrl.indexOf(SERVE_PATH_MARKER);
  if (markerIndex < 0) {
    return '';
  }

  const rawPath = originalUrl
    .slice(markerIndex + SERVE_PATH_MARKER.length)
    .split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

/**
 * REST endpoints for per-session virtual filesystem access.
 * Mounted at /api/sessions/:id/vfs/* (global prefix 'api' added in main.ts).
 */
@Controller('sessions/:id/vfs')
export class SessionVfsController {
  constructor(private readonly vfs: VFSService) {}

  private streamServedFile(sessionId: string, path: string, res: Response): StreamableFile {
    const { content, stream, mimeType } = this.vfs.serveFile(sessionId, path);
    res.set({
      'Cache-Control': 'no-store',
      'Content-Type': mimeType,
    });

    if (content !== undefined) {
      return new StreamableFile(content);
    }

    if (stream !== undefined) {
      return new StreamableFile(stream);
    }

    throw new Error(`VFS serve for ${path} returned no content`);
  }

  @Get()
  list(@Param('id') sessionId: string): VFSListResult {
    return this.vfs.listFiles(sessionId);
  }

  @Post()
  @HttpCode(200)
  async writeText(
    @Param('id') sessionId: string,
    @Body() body: { filePath: string; content: string },
  ): Promise<{ ok: boolean }> {
    if (!body.filePath) throw new BadRequestException('filePath is required');
    if (body.content === undefined) throw new BadRequestException('content is required');
    try {
      this.vfs.writeFile({ sessionId, filePath: body.filePath, content: body.content });
      await this.vfs.touchSession(sessionId);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'PATH_TRAVERSAL_DENIED') {
        throw new BadRequestException((err as Error).message);
      }
      throw err;
    }
    return { ok: true };
  }

  @Get('read')
  read(@Param('id') sessionId: string, @Query('path') path: string): VFSReadResult {
    try {
      return this.vfs.readFile(sessionId, path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'PATH_TRAVERSAL_DENIED') {
        throw new BadRequestException((err as Error).message);
      }
      throw err;
    }
  }

  @Get('download')
  download(
    @Param('id') sessionId: string,
    @Query('path') path: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const { stream, filename } = this.vfs.downloadFile(sessionId, path);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(stream);
  }

  @Get('serve')
  serve(
    @Param('id') sessionId: string,
    @Query('path') path: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    try {
      return this.streamServedFile(sessionId, path, res);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'PATH_TRAVERSAL_DENIED') {
        throw new BadRequestException((err as Error).message);
      }
      throw err;
    }
  }

  @Get('serve-path/*path')
  servePath(
    @Param('id') sessionId: string,
    @Param('path') path: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: Pick<Request, 'originalUrl'>,
  ): StreamableFile {
    try {
      const resolvedPath = resolveServePath(path, req);
      if (!resolvedPath) {
        throw new BadRequestException('path is required');
      }

      return this.streamServedFile(sessionId, resolvedPath, res);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'PATH_TRAVERSAL_DENIED') {
        throw new BadRequestException((err as Error).message);
      }
      throw err;
    }
  }

  /**
   * Upload a single image into the per-session VFS under `uploads/<id>.<ext>`.
   * Returns a `ChatAttachment` reference the FE can include in the next
   * `chat:send` payload — bytes never travel over Socket.IO.
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES } }))
  async upload(
    @Param('id') sessionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ChatAttachment> {
    if (!file) throw new BadRequestException('No file provided in field "file"');
    const ext = ALLOWED_UPLOAD_MIMES[file.mimetype];
    if (!ext) {
      throw new UnsupportedMediaTypeException(
        `Unsupported mime type: ${file.mimetype}. Allowed: ${Object.keys(ALLOWED_UPLOAD_MIMES).join(', ')}`,
      );
    }
    const path = `uploads/${nanoid()}.${ext}`;
    this.vfs.writeBinary(sessionId, path, file.buffer);
    await this.vfs.touchSession(sessionId);
    return { path, mimeType: file.mimetype };
  }

  @Get('zip')
  zip(@Param('id') sessionId: string, @Res({ passthrough: true }) res: Response): StreamableFile {
    const archive = this.vfs.archiveSession(sessionId);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="session-${sessionId}.zip"`,
    });
    return new StreamableFile(archive);
  }
}
