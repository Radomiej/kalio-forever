import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { nanoid } from 'nanoid';
import type { Response } from 'express';
import type { ChatAttachment, VFSListResult, VFSReadResult } from '@kalio/types';
import { VFSService } from './vfs.service';

const ALLOWED_UPLOAD_MIMES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const UPLOAD_MAX_BYTES = 10 << 20; // 10 MB request body

/**
 * REST endpoints for per-session virtual filesystem access.
 * Mounted at /api/sessions/:id/vfs/* (global prefix 'api' added in main.ts).
 */
@Controller('sessions/:id/vfs')
export class SessionVfsController {
  constructor(private readonly vfs: VFSService) {}

  @Get()
  list(@Param('id') sessionId: string): VFSListResult {
    return this.vfs.listFiles(sessionId);
  }

  @Get('read')
  read(@Param('id') sessionId: string, @Query('path') path: string): VFSReadResult {
    return this.vfs.readFile(sessionId, path);
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

  /**
   * Upload a single image into the per-session VFS under `uploads/<id>.<ext>`.
   * Returns a `ChatAttachment` reference the FE can include in the next
   * `chat:send` payload — bytes never travel over Socket.IO.
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES } }))
  upload(
    @Param('id') sessionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): ChatAttachment {
    if (!file) throw new BadRequestException('No file provided in field "file"');
    const ext = ALLOWED_UPLOAD_MIMES[file.mimetype];
    if (!ext) {
      throw new UnsupportedMediaTypeException(
        `Unsupported mime type: ${file.mimetype}. Allowed: ${Object.keys(ALLOWED_UPLOAD_MIMES).join(', ')}`,
      );
    }
    const path = `uploads/${nanoid()}.${ext}`;
    this.vfs.writeBinary(sessionId, path, file.buffer);
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
