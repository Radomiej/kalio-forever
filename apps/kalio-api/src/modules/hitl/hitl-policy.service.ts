import { Injectable, Logger, Optional } from '@nestjs/common';
import { HitlConfigService } from './hitl-config.service';
import { HitlDecisionService } from './hitl-decision.service';
import { HitlDecisionProtocolError, HitlJevService } from './hitl-jev.service';
import { classifyJevAssessment } from './hitl-jev-assessment';
import { HitlLocalDecisionService } from './hitl-local-decision.service';
import type { HitlApprovalRequest, HitlApprovalResolution, HitlConfig } from './hitl.types';
import { matchingHitlHardRule } from './hitl-rules.utils';

@Injectable()
export class HitlPolicyService {
  private readonly logger = new Logger(HitlPolicyService.name);

  constructor(
    private readonly hitlConfig: HitlConfigService,
    private readonly decisionService: HitlDecisionService,
    @Optional() private readonly jevService?: HitlJevService,
    @Optional() private readonly localDecision?: HitlLocalDecisionService,
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
          if (this.delegatesToJev(config, request)) return this.resolveWithJev(config, request);
          if (this.requiresHumanToolApproval(request)) return { status: 'manual', source: 'manual' };
          return { status: 'approved', source: 'rule', reason: `Allowed by HITL rule ${hardRule.id}.` };
        }
        return { status: 'manual', source: 'manual' };
      }

      if (config.mode === 'bypass') return { status: 'approved', source: 'bypass' };
      if (config.mode === 'manual') return { status: 'manual', source: 'manual' };
      if (config.mode === 'ollama') {
        if (!this.localDecision || this.hitlConfig.changing || request.kind !== 'tool' || this.requiresHumanToolApproval(request)) return { status: 'manual', source: 'manual' };
        const before = JSON.stringify(config);
        const revision = this.hitlConfig.revision;
        const result = await this.localDecision.evaluateApproval(request);
        try {
          request.abortSignal?.throwIfAborted();
          if (JSON.stringify(await this.hitlConfig.getConfig()) !== before || this.hitlConfig.changing || this.hitlConfig.revision !== revision) return { status: 'manual', source: 'manual', reason: 'Local decision policy changed.' };
          request.abortSignal?.throwIfAborted();
          if (result.status === 'evaluated' && (!await this.localDecision.consume(result) || this.hitlConfig.changing || this.hitlConfig.revision !== revision)) {
            return { status: 'manual', source: 'manual', reason: 'Local decision is no longer current.' };
          }
          request.abortSignal?.throwIfAborted();
          if (result.status === 'evaluated') {
            const reason = `Local decision (${result.model}): ${result.verdict}. ${result.reason}`;
            if (result.verdict === 'allow') return { status: 'approved', source: 'ollama', reason };
            if (result.verdict === 'deny') return { status: 'rejected', source: 'ollama', reason };
            return { status: 'manual', source: 'manual', reason };
          }
          return { status: 'manual', source: 'manual', reason: 'Local decision requires manual review.' };
        } finally { this.localDecision.discard(result); }
      }
      if (config.mode === 'auto') {
        return this.resolveWithPersona(config.autoPersonaId, request, 'auto');
      }

      if (config.confirmationAuthority === 'human_then_decision') return { status: 'manual', source: 'manual', reason: 'Human-first review; Jev may assess only after the configured wait expires.' };

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
      if (hardRule?.decision === 'ask_user') return { status: 'manual', source: 'manual', reason: 'An always-ask rule requires a human.' };
      if (config.mode === 'jev' && config.confirmationAuthority === 'human_then_decision') {
        return this.resolveWithJev(config, request, true);
      }
      if (hardRule?.decision === 'allow') {
        if (this.requiresHumanToolApproval(request)) return { status: 'manual', source: 'manual' };
        return { status: 'approved', source: 'rule', reason: `Allowed by HITL rule ${hardRule.id}.` };
      }
      if (hardRule?.decision === 'ask_user') {
        return { status: 'manual', source: 'manual' };
      }

      if (config.mode === 'bypass') return { status: 'approved', source: 'bypass' };
      if (config.mode === 'jev' || config.mode === 'ollama') return { status: 'manual', source: 'manual' };
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
    afterHumanTimeout = false,
  ): Promise<HitlApprovalResolution> {
    const delegated = this.delegatesToJev(config, request, afterHumanTimeout);
    try {
      const revision = this.hitlConfig.revision;
      const binding = this.requestBinding(request);
      const policy = JSON.stringify(config);
      if (delegated && (!request.toolCallId || this.hitlConfig.changing)) return { status: 'manual', source: 'manual', reason: 'Decision authority is not current.' };
      const threshold = config.jevApprovalThreshold ?? 0.95;
      if (!Number.isFinite(threshold) || threshold <= 0.5 || threshold > 1) {
        throw new Error('Invalid Jev approval threshold.');
      }
      if (!this.jevService) throw new Error('Jev HITL evaluator is not configured.');
      const result = await this.jevService.evaluateApproval(config, request);
      request.abortSignal?.throwIfAborted();
      if ('assessment' in result) {
        if (!delegated) throw new HitlDecisionProtocolError('Unexpected contextual assessment.');
        const decision = classifyJevAssessment(result, threshold);
        if (result.validateContext() !== true) throw new HitlDecisionProtocolError('Review context changed; human review required.');
        if (decision.status !== 'approved') return { ...decision, source: decision.status === 'rejected' ? 'jev' : 'manual' };
        if (this.hitlConfig.changing || this.hitlConfig.revision !== revision || JSON.stringify(await this.hitlConfig.getConfig()) !== policy
          || this.requestBinding(request) !== binding || result.validateContext() !== true) {
          return { status: 'manual', source: 'manual', reason: 'Approval request, policy or context changed during Jev evaluation.' };
        }
        let unused = true;
        return { status: 'approved', source: 'jev', reason: decision.reason,
          validateBeforeExecution: async () => {
            if (!unused) return false;
            unused = false;
            request.abortSignal?.throwIfAborted();
            const fresh = await this.hitlConfig.getConfig();
            request.abortSignal?.throwIfAborted();
            return !this.hitlConfig.changing && this.hitlConfig.revision === revision && JSON.stringify(fresh) === policy
              && this.requestBinding(request) === binding && result.validateContext() === true;
          } };
      }
      if (delegated) throw new HitlDecisionProtocolError('Delegated approval requires contextual checks.');
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
      if (delegated) return { status: 'manual', source: 'manual', reason: err instanceof HitlDecisionProtocolError
        ? err.message : 'Contextual Jev assessment failed; human review required.' };
      if (err instanceof HitlDecisionProtocolError) return { status: 'manual', source: 'manual' };
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Jev HITL evaluation failed; falling back to the configured persona or manual review', error);
      return config.jevFallbackToPersona === true
        ? this.resolveWithPersona(config.autoPersonaId, request, 'jev')
        : { status: 'manual', source: 'manual' };
    }
  }

  private requestBinding(request: HitlApprovalRequest): string {
    return JSON.stringify({ sessionId: request.sessionId, runId: request.runId, turnId: request.turnId,
      promptMessageId: request.promptMessageId, toolCallId: request.toolCallId, name: request.name, args: request.args });
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

  private delegatesToJev(config: HitlConfig, request: HitlApprovalRequest, afterHumanTimeout = false): boolean {
    return config.mode === 'jev' && request.kind === 'tool' && (config.confirmationAuthority === 'decision_model'
      || (afterHumanTimeout && config.confirmationAuthority === 'human_then_decision'));
  }

  async getManualReviewTimeoutMs(request: HitlApprovalRequest): Promise<number | undefined> {
    const config = await this.hitlConfig.getConfig();
    if (config.mode !== 'jev') return undefined;
    if (matchingHitlHardRule(request, config.rules ?? [])?.decision === 'ask_user') return 0;
    return config.confirmationAuthority === 'human_then_decision' ? config.humanReviewTimeoutMs ?? 60_000 : 0;
  }

  async reviewsSubagentAutoApprovals(): Promise<boolean> {
    return (await this.hitlConfig.getConfig()).mode === 'jev';
  }
}
