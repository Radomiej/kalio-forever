import { Injectable } from '@nestjs/common';
import type { ChatRunSnapshot } from '@kalio/types';
import type { RunSubagentRequest, RunSubagentResult } from '../tool/subagent-runtime.port';
import { RunJournalService } from './run-journal.service';

@Injectable()
export class SubagentResultReplayService {
  constructor(private readonly runs: RunJournalService) {}

  async findCompleted(childSessionId: string, turnId: string): Promise<ChatRunSnapshot['outcome'] | null> {
    const run = await this.runs.getCompletedTurn(childSessionId, turnId);
    return run?.outcome?.finalText ? run.outcome : null;
  }

  async replay(
    request: RunSubagentRequest,
    childSessionId: string,
    vfsSessionId: string,
    durationMs: number,
  ): Promise<RunSubagentResult | null> {
    if (!request.resumeTurnId) return null;
    const cached = await this.findCompleted(childSessionId, request.resumeTurnId);
    if (!cached) return null;
    return {
      result: cached.finalText,
      structuredOutput: cached.structuredOutput,
      taskId: `replay-${request.resumeTurnId}`,
      childSessionId,
      parentSessionId: request.parentSessionId,
      status: 'completed',
      vfsMode: request.vfsMode,
      vfsSessionId,
      copiedFiles: [],
      durationMs,
    };
  }
}
