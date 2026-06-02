import { Injectable, Logger } from '@nestjs/common';
import { HitlConfigService } from './hitl-config.service';
import { HitlDecisionService } from './hitl-decision.service';
import type { HitlApprovalRequest, HitlApprovalResolution } from './hitl.types';

@Injectable()
export class HitlPolicyService {
  private readonly logger = new Logger(HitlPolicyService.name);

  constructor(
    private readonly hitlConfig: HitlConfigService,
    private readonly decisionService: HitlDecisionService,
  ) {}

  async resolveApproval(_request: HitlApprovalRequest): Promise<HitlApprovalResolution> {
    const request = _request;

    try {
      const config = await this.hitlConfig.getConfig();

      if (config.mode === 'manual') {
        return { status: 'manual', source: 'manual' };
      }

      if (config.mode === 'bypass') {
        return { status: 'approved', source: 'bypass' };
      }

      if (!config.autoPersonaId) {
        return { status: 'manual', source: 'manual' };
      }

      const decision = await this.decisionService.evaluateApproval({
        personaId: config.autoPersonaId,
        request,
      });

      return decision.agree
        ? { status: 'approved', source: 'auto', reason: decision.reason }
        : { status: 'rejected', source: 'auto', reason: decision.reason };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Auto HITL policy failed; falling back to manual review', error);
      return { status: 'manual', source: 'manual' };
    }
  }

  async resolveUnattendedApproval(request: HitlApprovalRequest): Promise<HitlApprovalResolution> {
    try {
      const config = await this.hitlConfig.getConfig();

      if (config.unattendedFallback !== 'representative' || !config.representativePersonaId) {
        return { status: 'manual', source: 'manual', reason: 'Unattended HITL fallback is paused.' };
      }

      const decision = await this.decisionService.evaluateApproval({
        personaId: config.representativePersonaId,
        request,
      });

      return decision.agree
        ? { status: 'approved', source: 'representative', reason: decision.reason }
        : { status: 'rejected', source: 'representative', reason: decision.reason };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Representative HITL fallback failed; keeping manual review paused', error);
      return { status: 'manual', source: 'manual' };
    }
  }
}
