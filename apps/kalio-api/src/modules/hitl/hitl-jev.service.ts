import { Inject, Injectable } from '@nestjs/common';
import { DECISION_SETTINGS, type DecisionSettingsPort, type HitlConfig } from '@kalio/types';
import { JevDecisionsClient, type JevNoulResult } from '../../common/jev-decisions.client';
import { sanitizeJevState } from '../../common/jev-state-sanitizer';

import type { HitlApprovalRequest } from './hitl.types';

export class HitlDecisionProtocolError extends Error {}

@Injectable()
export class HitlJevService {
  constructor(
    @Inject(DECISION_SETTINGS) private readonly decisions: DecisionSettingsPort,
    private readonly jev: JevDecisionsClient,
  ) {}

  async evaluateApproval(config: HitlConfig, request: HitlApprovalRequest): Promise<JevNoulResult> {
    request.abortSignal?.throwIfAborted();
    const settings = await this.decisions.getConfig('tools');
    if (settings.provider === 'ollama') throw new HitlDecisionProtocolError('Jev requires the Jev Decisions protocol.');
    const connection = await this.decisions.resolve('tools');
    request.abortSignal?.throwIfAborted();
    if (connection.protocol !== 'jev-decisions') throw new HitlDecisionProtocolError('Jev requires the Jev Decisions protocol.');

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
