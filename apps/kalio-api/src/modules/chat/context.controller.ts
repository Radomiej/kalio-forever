import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import type { ContextPreviewRequest, LLMContextPreview } from '@kalio/types';
import { ContextPreviewService } from './context-preview.service';

@Controller('context')
export class ContextController {
  constructor(private readonly contextPreview: ContextPreviewService) {}

  @Post('preview')
  preview(@Body() body: ContextPreviewRequest): Promise<LLMContextPreview> {
    if (!body.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    return this.contextPreview.buildPreview(body.sessionId, body);
  }
}
