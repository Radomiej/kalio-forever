import { Injectable, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { LLMService } from '../llm/llm.service';
import { PersonaService } from '../persona/persona.service';
import { SkillsService } from '../skills/skills.service';
import type { HitlDecisionInput, HitlDecisionResult } from './hitl.types';

const AUTO_HITL_SYSTEM_APPENDIX = [
  'You are the approval authority for human-in-the-loop gating.',
  'Decide whether the described operation should be approved.',
  'Return only valid JSON with this exact shape: {"agree": true|false, "reason": "short explanation"}.',
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
  const reason = parsed['reason'];

  if (typeof agree !== 'boolean') {
    throw new Error('Auto HITL response is missing a boolean agree field.');
  }

  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('Auto HITL response is missing a non-empty reason field.');
  }

  return {
    agree,
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
            agree: 'boolean',
            reason: 'string',
          },
        }, null, 2),
      },
    ];

    let rawResponse = '';
    await this.llmService.streamChat(messages, [], {
      sessionId: `hitl:${input.request.sessionId}`,
      messageId: nanoid(),
      abortSignal: input.request.abortSignal,
      onChunk: (chunk) => {
        if (!chunk.thinking) {
          rawResponse += chunk.delta;
        }
      },
    });

    try {
      return parseDecision(rawResponse);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Failed to parse auto HITL evaluator response', error);
      throw error;
    }
  }
}