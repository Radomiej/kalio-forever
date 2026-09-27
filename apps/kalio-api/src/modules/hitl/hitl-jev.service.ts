import { BadRequestException, Injectable } from '@nestjs/common';
import type { HitlConfig } from '@kalio/types';
import { JevDecisionsClient, type JevNoulResult } from '../../common/jev-decisions.client';
import { sanitizeJevState } from '../../common/jev-state-sanitizer';
import { CredentialsService } from '../credentials/credentials.service';
import type { HitlApprovalRequest } from './hitl.types';

@Injectable()
export class HitlJevService {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly jev: JevDecisionsClient,
  ) {}

  async evaluateApproval(config: HitlConfig, request: HitlApprovalRequest): Promise<JevNoulResult> {
    const credentialId = config.jevCredentialId;
    if (!credentialId) {
      throw new BadRequestException('No OpenRouter credential is configured for Jev.');
    }

    const providerConfig = await this.credentials.getProviderConfigForCredential(credentialId);
    if (!providerConfig || providerConfig.provider !== 'openrouter' || !providerConfig.apiKey.trim()) {
      throw new BadRequestException('The selected Jev credential is not a usable OpenRouter credential.');
    }

    return this.jev.decideNoul({
      apiKey: providerConfig.apiKey,
      questionId: 'approval',
      instructions: [
        'Should the requested operation be allowed? Return the probability that the answer is yes.',
        config.jevInstructions,
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
  }
}
