import { Injectable, Logger, Optional } from '@nestjs/common';
import { HitlConfigService } from './hitl-config.service';
import { HitlDecisionService } from './hitl-decision.service';
import { HitlJevService } from './hitl-jev.service';
import type { HitlApprovalRequest, HitlApprovalResolution } from './hitl.types';
import { matchingHitlHardRule } from './hitl-rules.utils';

@Injectable()
export class HitlPolicyService {
  private readonly logger = new Logger(HitlPolicyService.name);

  constructor(
    private readonly hitlConfig: HitlConfigService,
    private readonly decisionService: HitlDecisionService,
    @Optional() private readonly jevService?: HitlJevService,
  ) {}

  async resolveApproval(_request: HitlApprovalRequest): Promise<HitlApprovalResolution> {
    const request = _request;

    try {
      const config = await this.hitlConfig.getConfig();

      if (config.mode === 'bypass') {
        return { status: 'approved', source: 'bypass' };
      }

      const hardRule = matchingHitlHardRule(request, config.rules);
      if (hardRule) {
        if (hardRule.decision === 'deny') {
          return { status: 'rejected', source: 'rule', reason: `Denied by HITL rule ${hardRule.id}.` };
        }
        if (hardRule.decision === 'allow') {
          return { status: 'approved', source: 'rule', reason: `Allowed by HITL rule ${hardRule.id}.` };
        }
        return { status: 'manual', source: 'manual' };
      }

      if (config.mode === 'manual') return { status: 'manual', source: 'manual' };
      if (config.mode === 'auto') {
        return this.resolveWithPersona(config.autoPersonaId, request, 'auto');
      }

      return this.resolveWithJev(config, request);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Auto HITL policy failed; falling back to manual review', error);
      return { status: 'manual', source: 'manual' };
    }
  }

  async resolveUnattendedApproval(request: HitlApprovalRequest): Promise<HitlApprovalResolution> {
    try {
      const config = await this.hitlConfig.getConfig();

      if (config.mode === 'bypass') {
        return { status: 'approved', source: 'bypass' };
      }

      const hardRule = matchingHitlHardRule(request, config.rules);
      if (hardRule?.decision === 'deny') {
        return { status: 'rejected', source: 'rule', reason: `Denied by HITL rule ${hardRule.id}.` };
      }
      if (hardRule?.decision === 'allow') {
        return { status: 'approved', source: 'rule', reason: `Allowed by HITL rule ${hardRule.id}.` };
      }
      if (hardRule?.decision === 'ask_user') {
        return { status: 'manual', source: 'manual' };
      }

      if (config.unattendedFallback !== 'representative' || !config.representativePersonaId) {
        return { status: 'manual', source: 'manual', reason: 'Unattended HITL fallback is paused.' };
      }

      const decision = await this.decisionService.evaluateApproval({
        personaId: config.representativePersonaId,
        request,
      });

      if (decision.decision === 'ask_user') {
        return { status: 'manual', source: 'manual', reason: decision.reason };
      }
      if (decision.decision === 'allow') {
        return { status: 'approved', source: 'representative', reason: decision.reason };
      }
      if (decision.decision === 'deny') {
        return { status: 'rejected', source: 'representative', reason: decision.reason };
      }
      return decision.agree
        ? { status: 'approved', source: 'representative', reason: decision.reason }
        : { status: 'rejected', source: 'representative', reason: decision.reason };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Representative HITL fallback failed; keeping manual review paused', error);
      return { status: 'manual', source: 'manual' };
    }
  }

  private async resolveWithJev(
    config: Awaited<ReturnType<HitlConfigService['getConfig']>>,
    request: HitlApprovalRequest,
  ): Promise<HitlApprovalResolution> {
    try {
      if (!this.jevService) throw new Error('Jev HITL evaluator is not configured.');
      const result = await this.jevService.evaluateApproval(config, request);
      const reason = `Jev p(allow)=${result.probability.toFixed(2)}; threshold=${config.jevApprovalThreshold.toFixed(2)}.`;
      const boundaryTolerance = 1e-9;
      if (result.probability + boundaryTolerance >= config.jevApprovalThreshold) {
        return { status: 'approved', source: 'jev', reason };
      }
      if (result.probability <= 1 - config.jevApprovalThreshold + boundaryTolerance) {
        return { status: 'rejected', source: 'jev', reason };
      }
      return this.resolveWithPersona(config.autoPersonaId, request, 'jev');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Jev HITL evaluation failed; falling back to the configured persona or manual review', error);
      return this.resolveWithPersona(config.autoPersonaId, request, 'jev');
    }
  }

  private async resolveWithPersona(
    personaId: string | null,
    request: HitlApprovalRequest,
    source: 'auto' | 'jev',
  ): Promise<HitlApprovalResolution> {
    if (!personaId) return { status: 'manual', source: 'manual' };
    try {
      const decision = await this.decisionService.evaluateApproval({ personaId, request });
      if (decision.decision === 'ask_user') return { status: 'manual', source: 'manual', reason: decision.reason };
      if (decision.decision === 'allow') return { status: 'approved', source, reason: decision.reason };
      if (decision.decision === 'deny') return { status: 'rejected', source, reason: decision.reason };
      return decision.agree
        ? { status: 'approved', source, reason: decision.reason }
        : { status: 'rejected', source, reason: decision.reason };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('HITL persona evaluation failed; falling back to manual review', error);
      return { status: 'manual', source: 'manual' };
    }
  }
}
