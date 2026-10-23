import { Injectable, Logger, Optional } from '@nestjs/common';
import { HitlConfigService } from './hitl-config.service';
import { HitlDecisionService } from './hitl-decision.service';
import { HitlJevService } from './hitl-jev.service';
import type { HitlApprovalRequest, HitlApprovalResolution, HitlConfig } from './hitl.types';
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
      request.abortSignal?.throwIfAborted();
      const config = await this.hitlConfig.getConfig();
      request.abortSignal?.throwIfAborted();

      const hardRule = matchingHitlHardRule(request, config.rules ?? []);
      if (hardRule) {
        if (hardRule.decision === 'deny') {
          return { status: 'rejected', source: 'rule', reason: `Denied by HITL rule ${hardRule.id}.` };
        }
        if (hardRule.decision === 'allow') {
          if (this.requiresHumanToolApproval(request)) return { status: 'manual', source: 'manual' };
          return { status: 'approved', source: 'rule', reason: `Allowed by HITL rule ${hardRule.id}.` };
        }
        return { status: 'manual', source: 'manual' };
      }

      if (config.mode === 'bypass') return { status: 'approved', source: 'bypass' };
      if (config.mode === 'manual') return { status: 'manual', source: 'manual' };
      if (config.mode === 'auto') {
        return this.resolveWithPersona(config.autoPersonaId, request, 'auto');
      }

      return this.resolveWithJev(config, request);
    } catch (err) {
      request.abortSignal?.throwIfAborted();
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Auto HITL policy failed; falling back to manual review', error);
      return { status: 'manual', source: 'manual' };
    }
  }

  async resolveUnattendedApproval(request: HitlApprovalRequest): Promise<HitlApprovalResolution> {
    try {
      request.abortSignal?.throwIfAborted();
      const config = await this.hitlConfig.getConfig();
      request.abortSignal?.throwIfAborted();

      const hardRule = matchingHitlHardRule(request, config.rules ?? []);
      if (hardRule?.decision === 'deny') {
        return { status: 'rejected', source: 'rule', reason: `Denied by HITL rule ${hardRule.id}.` };
      }
      if (hardRule?.decision === 'allow') {
        if (this.requiresHumanToolApproval(request)) return { status: 'manual', source: 'manual' };
        return { status: 'approved', source: 'rule', reason: `Allowed by HITL rule ${hardRule.id}.` };
      }
      if (hardRule?.decision === 'ask_user') {
        return { status: 'manual', source: 'manual' };
      }

      if (config.mode === 'bypass') return { status: 'approved', source: 'bypass' };
      if (config.mode === 'jev') return { status: 'manual', source: 'manual' };
      if (config.unattendedFallback !== 'representative' || !config.representativePersonaId) {
        return { status: 'manual', source: 'manual', reason: 'Unattended HITL fallback is paused.' };
      }

      const decision = await this.decisionService.evaluateApproval({
        personaId: config.representativePersonaId,
        request,
      });
      request.abortSignal?.throwIfAborted();

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
      request.abortSignal?.throwIfAborted();
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Representative HITL fallback failed; keeping manual review paused', error);
      return { status: 'manual', source: 'manual' };
    }
  }

  private async resolveWithJev(
    config: HitlConfig,
    request: HitlApprovalRequest,
  ): Promise<HitlApprovalResolution> {
    try {
      const threshold = config.jevApprovalThreshold ?? 0.95;
      if (!Number.isFinite(threshold) || threshold <= 0.5 || threshold > 1) {
        throw new Error('Invalid Jev approval threshold.');
      }
      if (!this.jevService) throw new Error('Jev HITL evaluator is not configured.');
      const result = await this.jevService.evaluateApproval(config, request);
      request.abortSignal?.throwIfAborted();
      if (!Number.isFinite(result.probability) || result.probability < 0 || result.probability > 1) {
        throw new Error('Invalid Jev probability or approval threshold.');
      }
      const reason = `Jev p(allow)=${result.probability.toFixed(2)}; threshold=${threshold.toFixed(2)}.`;
      if (result.probability >= threshold) {
        if (this.requiresHumanToolApproval(request)) return { status: 'manual', source: 'manual', reason };
        return { status: 'approved', source: 'jev', reason };
      }
      if (1 - result.probability >= threshold) {
        return { status: 'rejected', source: 'jev', reason };
      }
      return config.jevFallbackToPersona === true
        ? this.resolveWithPersona(config.autoPersonaId, request, 'jev')
        : { status: 'manual', source: 'manual', reason };
    } catch (err) {
      request.abortSignal?.throwIfAborted();
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Jev HITL evaluation failed; falling back to the configured persona or manual review', error);
      return config.jevFallbackToPersona === true
        ? this.resolveWithPersona(config.autoPersonaId, request, 'jev')
        : { status: 'manual', source: 'manual' };
    }
  }

  private async resolveWithPersona(
    personaId: string | null,
    request: HitlApprovalRequest,
    source: 'auto' | 'jev',
  ): Promise<HitlApprovalResolution> {
    if (!personaId) return { status: 'manual', source: 'manual' };
    try {
      request.abortSignal?.throwIfAborted();
      const decision = await this.decisionService.evaluateApproval({ personaId, request });
      request.abortSignal?.throwIfAborted();
      if (decision.decision === 'ask_user') return { status: 'manual', source: 'manual', reason: decision.reason };
      if (source === 'jev' && this.requiresHumanToolApproval(request)
        && (decision.decision === 'allow' || (!decision.decision && decision.agree))) {
        return { status: 'manual', source: 'manual', reason: decision.reason };
      }
      if (decision.decision === 'allow') return { status: 'approved', source, reason: decision.reason };
      if (decision.decision === 'deny') return { status: 'rejected', source, reason: decision.reason };
      return decision.agree
        ? { status: 'approved', source, reason: decision.reason }
        : { status: 'rejected', source, reason: decision.reason };
    } catch (err) {
      request.abortSignal?.throwIfAborted();
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('HITL persona evaluation failed; falling back to manual review', error);
      return { status: 'manual', source: 'manual' };
    }
  }

  private requiresHumanToolApproval(request: HitlApprovalRequest): boolean {
    // HITL requests do not carry trusted tool metadata. Only known read operations
    // may use new rule/Jev approval; other tools retain explicit human confirmation.
    return request.kind === 'tool' && ![
      'fs_read', 'fs_list', 'vfs_read', 'vfs_list', 'web_search', 'web_fetch',
    ].includes(request.name);
  }
}
