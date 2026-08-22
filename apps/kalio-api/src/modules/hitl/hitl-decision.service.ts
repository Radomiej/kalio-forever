import { Injectable, Logger, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { LLMService } from '../llm/llm.service';
import { PersonaService } from '../persona/persona.service';
import { SkillsService } from '../skills/skills.service';
import { ExecutionProfileService } from '../agent-runtime/execution-profile.service';
import { CodexAppServerLLMSource } from '../agent-runtime/codex-app-server.llm-source';
import type { HitlDecisionInput, HitlDecisionResult } from './hitl.types';

const AUTO_HITL_SYSTEM_APPENDIX = [
  'You are the approval authority for human-in-the-loop gating.',
  'Decide whether the described operation should be approved.',
  'Return only valid JSON with this exact shape: {"decision":"allow|deny|ask_user", "risk":"low|medium|high|critical", "reason":"short explanation"}.',
  'Do not wrap the JSON in markdown fences.',
  'Never call tools.',
].join(' ');

function buildSkillsSection(skills: Array<{ name: string; description: string; prompt: string }>): string {
  if (skills.length === 0) {
    return '';
  }

  return `\n\n## Active skills\n${skills
    .map((skill) => `### ${skill.name}\n${skill.description}\n\n${skill.prompt}`)
    .join('\n\n')}`;
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractJsonObject(raw: string): string {
  const unfenced = stripCodeFence(raw);
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return unfenced.slice(firstBrace, lastBrace + 1);
  }
  return unfenced;
}

function parseDecision(raw: string): HitlDecisionResult {
  const candidate = extractJsonObject(raw);
  const parsed = JSON.parse(candidate) as Record<string, unknown>;
  const agree = parsed['agree'];
  const decision = parsed['decision'];
  const risk = parsed['risk'];
  const reason = parsed['reason'];

  const normalizedAgree = typeof agree === 'boolean'
    ? agree
    : decision === 'allow'
      ? true
      : decision === 'deny' || decision === 'ask_user'
        ? false
        : undefined;
  if (normalizedAgree === undefined) {
    throw new Error('Auto HITL response is missing a boolean agree field.');
  }

  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('Auto HITL response is missing a non-empty reason field.');
  }

  if (risk !== undefined && risk !== 'low' && risk !== 'medium' && risk !== 'high' && risk !== 'critical') {
    throw new Error('Auto HITL response contains an invalid risk field.');
  }

  return {
    agree: normalizedAgree,
    ...(risk ? { risk } : {}),
    decision: decision === 'allow' || decision === 'deny' || decision === 'ask_user'
      ? decision
      : normalizedAgree ? 'allow' : 'deny',
    reason: reason.trim(),
  };
}

@Injectable()
export class HitlDecisionService {
  private readonly logger = new Logger(HitlDecisionService.name);

  constructor(
    private readonly personaService: PersonaService,
    private readonly skillsService: SkillsService,
    private readonly llmService: LLMService,
    @Optional() private readonly executionProfiles?: ExecutionProfileService,
    @Optional() private readonly codexSource?: CodexAppServerLLMSource,
  ) {}

  async evaluateApproval(input: HitlDecisionInput): Promise<HitlDecisionResult> {
    const personaConfig = await this.personaService.getSessionConfig(input.personaId);
    if (!personaConfig) {
      throw new Error(`Auto HITL persona ${input.personaId} was not found.`);
    }

    const activeSkills = personaConfig.skillIds.length > 0
      ? await this.skillsService.findByIds(personaConfig.skillIds)
      : [];

    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'system',
        content: `${personaConfig.systemPrompt}${buildSkillsSection(activeSkills)}\n\n${AUTO_HITL_SYSTEM_APPENDIX}`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          operation: {
            kind: input.request.kind,
            name: input.request.name,
            args: input.request.args,
            displayLabel: input.request.displayLabel,
            sessionId: input.request.sessionId,
            toolCallId: input.request.toolCallId,
            agentRun: input.request.agentRun,
          },
          requiredResponse: {
            decision: 'allow|deny|ask_user',
            risk: 'low|medium|high|critical',
            reason: 'string',
          },
        }, null, 2),
      },
    ];

    const rawResponse = await this.evaluateWithConfiguredProfile(personaConfig.executionProfileId, messages, input);

    try {
      return parseDecision(rawResponse);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Failed to parse auto HITL evaluator response', error);
      throw error;
    }
  }

  private async evaluateWithConfiguredProfile(
    profileId: string | undefined,
    messages: ContextManagedLLMMessage[],
    input: HitlDecisionInput,
  ): Promise<string> {
    const profile = profileId && this.executionProfiles
      ? await this.executionProfiles.assertEnabled(profileId)
      : undefined;
    if (profile?.kind === 'codex-app-server') {
      if (!this.codexSource) throw new Error('Codex App Server evaluator is not configured.');
      let response = '';
      for await (const chunk of this.codexSource.stream({
        messages,
        tools: [],
        sessionId: `hitl:${input.request.sessionId}:${nanoid()}`,
        messageId: nanoid(),
        executionProfile: profile,
        abortSignal: input.request.abortSignal,
      })) {
        if (chunk.type === 'text_delta') response += chunk.delta;
      }
      return response;
    }

    let response = '';
    await this.llmService.streamChat(messages, [], {
      sessionId: `hitl:${input.request.sessionId}`,
      messageId: nanoid(),
      abortSignal: input.request.abortSignal,
      ...(profile?.kind === 'direct-llm' && profile.model ? { modelOverride: profile.model } : {}),
      onChunk: (chunk) => {
        if (!chunk.thinking) response += chunk.delta;
      },
    });
    return response;
  }
}
