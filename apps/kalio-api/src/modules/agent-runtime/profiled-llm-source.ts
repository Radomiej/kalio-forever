import { Injectable } from '@nestjs/common';
import type { ILLMSource, LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import { LLMServiceAdapter } from '../chat/llm-service.adapter';
import { CodexAppServerLLMSource } from './codex-app-server.llm-source';

@Injectable()
export class ProfiledLLMSource implements ILLMSource {
  constructor(
    private readonly direct: LLMServiceAdapter,
    private readonly codex: CodexAppServerLLMSource,
  ) {}

  getConfig(): ReturnType<LLMServiceAdapter['getConfig']> {
    return this.direct.getConfig();
  }

  async *stream(params: LLMSourceParams): AsyncGenerator<InternalLLMChunk> {
    if (params.executionProfile?.kind === 'codex-app-server') {
      yield* this.codex.stream(params);
      return;
    }
    yield* this.direct.stream(params);
  }
}
