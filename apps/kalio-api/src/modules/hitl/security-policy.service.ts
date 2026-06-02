import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { SecurityPolicyRequest, SecurityPolicyResponse } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { auditLog, messages, sessions } from '../../database/schema';
import { HitlConfigService } from './hitl-config.service';
import { HitlDecisionService } from './hitl-decision.service';

@Injectable()
export class SecurityPolicyService {
  private readonly logger = new Logger(SecurityPolicyService.name);

  constructor(
    private readonly hitlConfig: HitlConfigService,
    private readonly hitlDecision: HitlDecisionService,
    private readonly drizzle: DrizzleService,
  ) {}

  async evaluate(rawRequest: unknown): Promise<SecurityPolicyResponse> {
    const request = normalizeSecurityPolicyRequest(rawRequest);
    const startedAt = Date.now();
    const config = await this.hitlConfig.getConfig();
    const sessionId = request.subject?.sessionId ?? null;

    let response: SecurityPolicyResponse;
    if (!config.externalPolicyEnabled) {
      response = {
        decision: 'ask_user',
        reason: 'External HITL policy service is disabled.',
        risk: request.risk,
      };
    } else if (!config.externalPolicyPersonaId) {
      response = {
        decision: 'ask_user',
        reason: 'External HITL policy service has no persona configured.',
        risk: request.risk,
      };
    } else {
      try {
        const decision = await this.hitlDecision.evaluateApproval({
          personaId: config.externalPolicyPersonaId,
          request: {
            kind: 'external_security',
            sessionId: sessionId ?? `external:${nanoid()}`,
            name: request.action.name,
            args: request as unknown as Record<string, unknown>,
            displayLabel: this.displayLabel(request),
            toolCallId: request.subject?.turnId,
          },
        });
        response = {
          decision: decision.agree ? 'allow' : 'deny',
          reason: decision.reason,
          risk: request.risk,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`External HITL policy failed: ${message}`);
        response = {
          decision: 'ask_user',
          reason: `External HITL policy failed: ${message}`,
          risk: request.risk,
        };
      }
    }

    const auditId = await this.logAudit(request, response, Date.now() - startedAt);
    await this.logConversationMessage(sessionId, request, response);

    return { ...response, auditId };
  }

  private displayLabel(request: SecurityPolicyRequest): string {
    return [
      request.source,
      request.subject?.agentId,
      request.action.kind,
      request.action.name,
    ].filter(Boolean).join(' / ');
  }

  private async logAudit(
    request: SecurityPolicyRequest,
    response: SecurityPolicyResponse,
    durationMs: number,
  ): Promise<string> {
    const id = nanoid();
    try {
      await this.drizzle.db.insert(auditLog).values({
        id,
        sessionId: request.subject?.sessionId ?? null,
        type: 'external_hitl',
        label: `External HITL ${response.decision}: ${request.action.name}`,
        data: {
          domain: 'hitl',
          approvalKind: 'external_security',
          eventType: `external_security_${response.decision}`,
          approvalId: id,
          requestId: id,
          request,
          response,
        },
        durationMs,
        chunkCount: null,
        createdAt: new Date(),
      });
    } catch (err) {
      this.logger.warn(`External HITL audit log failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return id;
  }

  private async logConversationMessage(
    sessionId: string | null,
    request: SecurityPolicyRequest,
    response: SecurityPolicyResponse,
  ): Promise<void> {
    if (!sessionId) return;

    try {
      const [session] = await this.drizzle.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (!session) return;

      await this.drizzle.db.insert(messages).values({
        id: nanoid(),
        sessionId,
        role: 'system',
        content: [
          'External HITL policy request',
          `Source: ${request.source}`,
          `Action: ${request.action.kind}/${request.action.name}`,
          `Risk: ${request.risk}`,
          `Decision: ${response.decision}`,
          `Reason: ${response.reason}`,
        ].join('\n'),
        thinking: null,
        toolCalls: null,
        toolCallId: null,
        attachments: null,
        createdAt: new Date(),
      });
    } catch (err) {
      this.logger.warn(`External HITL conversation message failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function normalizeSecurityPolicyRequest(raw: unknown): SecurityPolicyRequest {
  if (isRecord(raw) && isRecord(raw['request'])) {
    const nested = raw['request'];
    return {
      source: 'mcp-cli-agents',
      subject: {
        agentId: stringOrUndefined(nested['agentId']),
        sessionId: stringOrUndefined(nested['sessionId']),
        turnId: stringOrUndefined(nested['turnId']),
      },
      action: {
        kind: stringOrUndefined(nested['requestedAction']) ?? 'agent_prompt',
        name: stringOrUndefined(nested['requestedAction']) ?? 'agent_prompt',
        commandOrTool: stringOrUndefined(nested['commandOrTool']),
        workdir: stringOrUndefined(nested['workdir']),
      },
      risk: normalizeRisk(nested['risk']),
      context: {
        reason: stringOrUndefined(nested['reason']),
        outputExcerpt: stringOrUndefined(nested['outputExcerpt']),
        permissionMode: stringOrUndefined(nested['requestedMode']) ?? stringOrUndefined(raw['mode']),
      },
    };
  }

  if (isRecord(raw) && isRecord(raw['action'])) {
    const action = raw['action'];
    const subject = isRecord(raw['subject']) ? raw['subject'] : {};
    const context = isRecord(raw['context']) ? raw['context'] : {};
    return {
      source: stringOrUndefined(raw['source']) ?? 'manual',
      subject: {
        userId: stringOrUndefined(subject['userId']),
        agentId: stringOrUndefined(subject['agentId']),
        sessionId: stringOrUndefined(subject['sessionId']),
        turnId: stringOrUndefined(subject['turnId']),
      },
      action: {
        kind: stringOrUndefined(action['kind']) ?? 'tool',
        name: stringOrUndefined(action['name']) ?? stringOrUndefined(action['commandOrTool']) ?? 'unknown',
        commandOrTool: stringOrUndefined(action['commandOrTool']),
        args: isRecord(action['args']) ? action['args'] : undefined,
        workdir: stringOrUndefined(action['workdir']),
        paths: Array.isArray(action['paths']) ? action['paths'].filter((item): item is string => typeof item === 'string') : undefined,
      },
      risk: normalizeRisk(raw['risk']),
      context: {
        reason: stringOrUndefined(context['reason']),
        outputExcerpt: stringOrUndefined(context['outputExcerpt']),
        repo: stringOrUndefined(context['repo']),
        permissionMode: stringOrUndefined(context['permissionMode']),
      },
    };
  }

  return {
    source: 'manual',
    action: { kind: 'tool', name: 'unknown' },
    risk: 'medium',
    context: { reason: 'Unrecognized external policy request shape.' },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeRisk(value: unknown): SecurityPolicyRequest['risk'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical' ? value : 'medium';
}
