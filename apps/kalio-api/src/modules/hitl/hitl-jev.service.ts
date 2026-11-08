import { Inject, Injectable, Optional } from '@nestjs/common';
import { DECISION_SETTINGS, type DecisionSettingsPort, type HitlConfig } from '@kalio/types';
import { JevDecisionsClient } from '../../common/jev-decisions.client';
import { sanitizeJevState } from '../../common/jev-state-sanitizer';
import { TOOL_APPROVAL_CONTEXT, type ToolApprovalContextBinding, type ToolApprovalContextPort } from '../../common/tool-approval-context.port';
import {
  HitlDecisionProtocolError, isRecord, jevAssessmentQuestions, readJevAssessment, validContextFingerprint, validJevModel,
  type ContextualJevEvaluation, type JevApprovalEvaluation,
} from './hitl-jev-assessment';

import type { HitlApprovalRequest } from './hitl.types';

export { HitlDecisionProtocolError } from './hitl-jev-assessment';

@Injectable()
export class HitlJevService {
  constructor(
    @Inject(DECISION_SETTINGS) private readonly decisions: DecisionSettingsPort,
    private readonly jev: JevDecisionsClient,
    @Optional() @Inject(TOOL_APPROVAL_CONTEXT) private readonly context?: ToolApprovalContextPort,
  ) {}

  async evaluateApproval(config: HitlConfig, request: HitlApprovalRequest): Promise<JevApprovalEvaluation> {
    request.abortSignal?.throwIfAborted();
    if (request.kind === 'tool' && (config.confirmationAuthority === 'decision_model' || config.confirmationAuthority === 'human_then_decision')) {
      try {
        return await this.evaluateContextual(config, request);
      } catch (error) {
        request.abortSignal?.throwIfAborted();
        if (error instanceof HitlDecisionProtocolError) throw error;
        throw new HitlDecisionProtocolError('Delegated Jev assessment failed; manual review required.');
      }
    }
    const settings = await this.decisions.getConfig('tools');
    if (settings.provider === 'ollama') throw new HitlDecisionProtocolError('Jev requires the Jev Decisions protocol.');
    const connection = await this.decisions.resolve('tools');
    request.abortSignal?.throwIfAborted();
    if (connection.protocol !== 'jev-decisions') throw new HitlDecisionProtocolError('Jev requires the Jev Decisions protocol.');

    const operation = { host: { platform: process.platform }, operation: { kind: request.kind, name: request.name, displayLabel: request.displayLabel, args: request.args } };
    const state = sanitizeJevState(operation);
    const result = await this.jev.decideNoul({
      ...connection,
      questionId: 'approval',
      instructions: [
        'Should the requested operation be allowed? Return the probability that the answer is yes.',
        config.jevInstructions ?? '',
      ].filter(Boolean).join('\n\n').slice(0, 2_500),
      state,
      signal: request.abortSignal,
    });
    request.abortSignal?.throwIfAborted();
    return result;
  }

  private async evaluateContextual(config: HitlConfig, request: HitlApprovalRequest): Promise<ContextualJevEvaluation> {
    const reader = this.context;
    if (!reader || !request.sessionId?.trim() || !request.runId?.trim()
      || !request.turnId?.trim() || !request.promptMessageId?.trim()) {
      throw new HitlDecisionProtocolError('Missing approval context binding requires manual review.');
    }
    const binding: ToolApprovalContextBinding = {
      sessionId: request.sessionId, runId: request.runId, turnId: request.turnId, promptMessageId: request.promptMessageId,
    };
    const context = reader.read(binding);
    if (!context || context.version !== 1 || !validContextFingerprint(context.fingerprint)
      || !isRecord(context.binding) || (Object.keys(binding) as (keyof ToolApprovalContextBinding)[]).some((key) => context.binding[key] !== binding[key])) {
      throw new HitlDecisionProtocolError('Missing or mismatched approval context requires manual review.');
    }
    const questions = jevAssessmentQuestions(config.jevInstructions ?? '');
    const evidence = {
      host: { platform: process.platform },
      operation: { kind: request.kind, name: request.name, ...(request.displayLabel !== undefined ? { displayLabel: request.displayLabel } : {}), args: request.args },
      context,
    };
    const state = completeEvidence(evidence);
    const fingerprint = context.fingerprint;
    const settings = await this.decisions.getConfig('tools');
    request.abortSignal?.throwIfAborted();
    if (settings.provider === 'ollama') throw new HitlDecisionProtocolError('Jev requires the Jev Decisions protocol.');
    const connection = await this.decisions.resolve('tools');
    request.abortSignal?.throwIfAborted();
    if (connection.protocol !== 'jev-decisions') throw new HitlDecisionProtocolError('Jev requires the Jev Decisions protocol.');
    const wireQuestions = Object.fromEntries(questions.map(({ questionId, instructions, criteria }) => [questionId, { type: 'noul', instructions, criteria }]));
    if (!validJevModel(connection.model)) throw new HitlDecisionProtocolError('Invalid Jev model metadata requires manual review.');
    if (Buffer.byteLength(JSON.stringify({ model: connection.model, questions: wireQuestions, state }), 'utf8') > 65_536) {
      throw new HitlDecisionProtocolError('Incomplete approval evidence requires manual review.');
    }
    const result = await this.jev.decideNoulBatch({ ...connection, questions, state, signal: request.abortSignal });
    request.abortSignal?.throwIfAborted();
    const checks = readJevAssessment(result);
    const validateContext = () => {
      try {
        return !request.abortSignal?.aborted
          && (Object.keys(binding) as (keyof ToolApprovalContextBinding)[]).every((key) => request[key] === binding[key])
          && reader.isCurrent(binding, fingerprint) === true;
      } catch {
        // A failed readonly freshness lookup cannot authorize execution.
        return false;
      }
    };
    if (!validateContext()) throw new HitlDecisionProtocolError('Approval context changed; manual review required.');
    return { assessment: { checks, contextFingerprint: fingerprint }, model: result.model ?? connection.model, validateContext };
  }
}

function completeEvidence(evidence: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(evidence, (_key, value: unknown) => {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint'
      || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new HitlDecisionProtocolError('Incomplete approval evidence requires manual review.');
    }
    return value;
  });
  if (Buffer.byteLength(serialized, 'utf8') > 65_536) {
    throw new HitlDecisionProtocolError('Incomplete approval evidence requires manual review.');
  }
  const state = sanitizeJevState(evidence, 65_536, { maxStringCharacters: 65_536 });
  if (JSON.stringify(state) !== serialized) throw new HitlDecisionProtocolError('Incomplete approval evidence requires manual review.');
  // Detach the reviewed evidence from request objects while credentials/model resolve.
  return JSON.parse(serialized) as Record<string, unknown>;
}
