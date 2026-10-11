import { Inject, Injectable } from '@nestjs/common';
import { DECISION_SETTINGS, type DecisionSettingsPort, type HitlConfig } from '@kalio/types';
import { JevDecisionsClient, type JevNoulResult } from '../../common/jev-decisions.client';
import { sanitizeJevState } from '../../common/jev-state-sanitizer';

import type { HitlApprovalRequest } from './hitl.types';

@Injectable()
export class HitlJevService {
  constructor(
    @Inject(DECISION_SETTINGS) private readonly decisions: DecisionSettingsPort,
    private readonly jev: JevDecisionsClient,
  ) {}

  async evaluateApproval(config: HitlConfig, request: HitlApprovalRequest): Promise<JevNoulResult> {
    request.abortSignal?.throwIfAborted();
    const connection = await this.decisions.resolve();
    request.abortSignal?.throwIfAborted();

    const result = await this.jev.decideNoul({
      ...connection,
      questionId: 'approval',
      instructions: [
        'Should the requested operation be allowed? Return the probability that the answer is yes.',
        config.jevInstructions ?? '',
      ].filter(Boolean).join('\n\n').slice(0, 2_500),
      state: sanitizeJevState({
        operation: {
          kind: request.kind,
          name: request.name,
          displayLabel: request.displayLabel,
          args: request.args,
        },
      }),
      signal: request.abortSignal,
    });
    request.abortSignal?.throwIfAborted();
    return result;
  }
}
