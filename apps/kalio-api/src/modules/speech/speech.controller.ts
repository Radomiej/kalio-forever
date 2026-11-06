import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Put, Req, Res,
  ServiceUnavailableException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { SpeechAuthGuard } from './speech-auth.guard';
import { SpeechInstallService } from './speech-install.service';
import { SpeechInferenceService } from './speech-inference.service';
import { parseSpeechAudio, SPEECH_MAX_BYTES } from './speech-audio';

@Controller('speech')
@UseGuards(SpeechAuthGuard)
export class SpeechController {
  constructor(private readonly installService: SpeechInstallService, private readonly inference: SpeechInferenceService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status() { return this.installService.status(); }

  @Put('install')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  install(@Body() body: unknown) { this.emptyBody(body); return this.installService.install(); }

  @Put('install/cancel')
  @Header('Cache-Control', 'no-store')
  cancelInstall(@Body() body: unknown) { this.emptyBody(body); return this.installService.cancel(); }

  @Put('transcriptions/:requestId')
  @UseInterceptors(FileInterceptor('audio', {
    limits: { fileSize: SPEECH_MAX_BYTES, files: 1, fields: 1, fieldSize: 128, parts: 3 },
  }))
  @Header('Cache-Control', 'no-store')
  async transcribe(@Param('requestId') requestId: string, @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request,
    @Res({ passthrough: true }) res: Response) {
    this.identifier(requestId);
    let scope: AbortSignal | undefined;
    const onClose = () => { if (!res.writableEnded) this.inference.cancel(requestId); };
    try {
      if (!file || !['audio/wav', 'audio/wave', 'audio/x-wav'].includes(file.mimetype)) {
        throw new BadRequestException({ code: 'SPEECH_WAV_REQUIRED' });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1) {
        throw new BadRequestException({ code: 'SPEECH_SCOPE_REQUIRED' });
      }
      let metadata: { sessionId: string } | { draftId: string };
      if ('sessionId' in body && typeof body.sessionId === 'string') metadata = { sessionId: body.sessionId };
      else if ('draftId' in body && typeof body.draftId === 'string') metadata = { draftId: body.draftId };
      else throw new BadRequestException({ code: 'SPEECH_SCOPE_REQUIRED' });
      this.identifier('sessionId' in metadata ? metadata.sessionId : metadata.draftId);
      const { pcm, durationMs } = parseSpeechAudio(file.buffer);
      scope = this.inference.reserve(requestId);
      res.once('close', onClose);
      const root = await this.installService.installedRoot();
      if (!root) throw new ServiceUnavailableException({ code: 'SPEECH_NOT_INSTALLED' });
      if (scope.aborted || req.aborted || res.destroyed) throw new BadRequestException({ code: 'SPEECH_CANCELLED' });
      const text = await this.inference.transcribe(root, requestId, pcm, scope);
      if (scope.aborted || req.aborted || res.destroyed) throw new BadRequestException({ code: 'SPEECH_CANCELLED' });
      return { requestId, ...metadata, text, durationMs };
    } finally {
      res.removeListener('close', onClose);
      if (scope) this.inference.release(requestId, scope);
      file?.buffer.fill(0);
    }
  }

  @Put('transcriptions/:requestId/cancel')
  @Header('Cache-Control', 'no-store')
  cancel(@Param('requestId') requestId: string, @Body() body: unknown) {
    this.identifier(requestId); this.emptyBody(body);
    return { cancelled: this.inference.cancel(requestId) };
  }

  private identifier(value: string): void {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new BadRequestException({ code: 'SPEECH_ID_INVALID' });
  }

  private emptyBody(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) {
      throw new BadRequestException({ code: 'SPEECH_BODY_INVALID' });
    }
  }
}
