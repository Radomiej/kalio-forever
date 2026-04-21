import { Injectable, Logger } from '@nestjs/common';
import type { RAAppBlock, RAAppResult } from '@kalio/types';
import { RAAppSandboxService } from './raapp-sandbox.service';

@Injectable()
export class RAAppService {
  private readonly logger = new Logger(RAAppService.name);

  constructor(private readonly sandbox: RAAppSandboxService) {}

  async execute(block: RAAppBlock): Promise<RAAppResult> {
    if (block.type === 'html') {
      // HTML blocks are rendered client-side — BE validates only
      return { status: 'ready', renderedContent: block.content };
    }

    try {
      const result = await this.sandbox.execute(block.content);
      return { status: 'ready', renderedContent: result };
    } catch (err) {
      this.logger.error('[RAAppService] DSL execution error', err);
      return {
        status: 'error',
        error: {
          code: 'DSL_EXEC_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  parse(content: string): RAAppResult {
    // TODO Phase 7: full DSL parser
    if (!content || typeof content !== 'string') {
      return {
        status: 'error',
        error: { code: 'DSL_PARSE_ERROR', message: 'Empty or invalid DSL content' },
      };
    }
    return { status: 'ready', renderedContent: content };
  }
}
