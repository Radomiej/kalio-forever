import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { VFSListResult, VFSReadResult } from '@kalio/types';
import { VFSService } from './vfs.service';

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
