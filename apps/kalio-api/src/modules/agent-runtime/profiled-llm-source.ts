import { Injectable } from '@nestjs/common';
import type { ILLMSource, LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import { LLMServiceAdapter } from '../chat/llm-service.adapter';
import { CodexAppServerLLMSource } from './codex-app-server.llm-source';
import { ClaudeAgentSdkLLMSource } from './claude-agent-sdk.llm-source';
import { DevinApiLLMSource } from './devin-api.llm-source';
import { DevinCliAcpLLMSource } from './devin-cli-acp.llm-source';

@Injectable()
export class ProfiledLLMSource implements ILLMSource {
  constructor(
    private readonly direct: LLMServiceAdapter,
    private readonly codex: CodexAppServerLLMSource,
    private readonly claude: ClaudeAgentSdkLLMSource,
    private readonly devin: DevinApiLLMSource,
    private readonly devinCli: DevinCliAcpLLMSource,
  ) {}

  getConfig(): ReturnType<LLMServiceAdapter['getConfig']> {
    return this.direct.getConfig();
  }

  async *stream(params: LLMSourceParams): AsyncGenerator<InternalLLMChunk> {
    if (params.executionProfile?.kind === 'codex-app-server') {
      yield* this.codex.stream(params);
      return;
    }
    if (params.executionProfile?.kind === 'claude-agent-sdk') {
      yield* this.claude.stream(params);
      return;
    }
    if (params.executionProfile?.kind === 'devin-api') {
      yield* this.devin.stream(params);
      return;
    }
    if (params.executionProfile?.kind === 'devin-cli-acp') {
      yield* this.devinCli.stream(params);
      return;
    }
    yield* this.direct.stream(params);
  }
}
