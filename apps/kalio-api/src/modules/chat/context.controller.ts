import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import type { ContextPreviewRequest, LLMContextPreview } from '@kalio/types';
import { ContextPreviewService } from './context-preview.service';

const RUNTIME_PREVIEW_SESSION_ID = 'runtime-preview';

@Controller('context')
export class ContextController {
  constructor(private readonly contextPreview: ContextPreviewService) {}

  @Post('preview')
  preview(@Body() body: ContextPreviewRequest): Promise<LLMContextPreview> {
    if (body.target === 'runtime') {
      return this.contextPreview.buildPreview(RUNTIME_PREVIEW_SESSION_ID, body);
    }
    if (!body.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    return this.contextPreview.buildPreview(body.sessionId, body);
  }
}
