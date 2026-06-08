import { Injectable } from '@nestjs/common';
import type { PersonaSessionConfig, SessionRuntimeKind, Skill, ToolMeta, ToolPolicyDecision } from '@kalio/types';
import { PersonaService } from '../persona/persona.service';
import { SkillsService } from '../skills/skills.service';
import { buildSkillsSection, buildToolsSection } from './context-prompt-sections';
import { SUBAGENT_SYSTEM_PROMPT } from './subagent-system-prompt';
import { ToolPolicyService, type ToolPolicyRequest } from './tool-policy.service';

export interface AssembledContext {
  personaConfig: PersonaSessionConfig | null;
  model: string;
  systemPrompt: string;
  effectiveSystemPrompt: string;
  toolMetas: ToolMeta[];
  toolPolicy: ToolPolicyDecision;
  activeSkills: Skill[];
  runtimeKind: SessionRuntimeKind;
  warnings: string[];
}

export type RuntimeAssemblyProfile =
  | { runtimeKind: 'chat'; personaId: string; toolPolicyRequest?: Partial<ToolPolicyRequest> }
  | {
      runtimeKind: 'subagent';
      personaId: string;
      toolPolicyRequest: ToolPolicyRequest;
    }
  | {
      runtimeKind: 'agent-flow-branch';
      personaId: string;
      toolPolicyRequest: ToolPolicyRequest;
      systemPromptAdditions?: string;
      modelOverride?: string;
    };

@Injectable()
export class ContextAssemblyService {
  constructor(
    private readonly personaService: PersonaService,
    private readonly skillsService: SkillsService,
    private readonly toolPolicy: ToolPolicyService,
  ) {}

  async assemble(personaId: string): Promise<AssembledContext> {
    return this.assembleForRuntime({ runtimeKind: 'chat', personaId });
  }

  async assembleForRuntime(profile: RuntimeAssemblyProfile): Promise<AssembledContext> {
    const personaConfig = await this.personaService.getSessionConfig(profile.personaId);
    const systemPrompt = personaConfig?.systemPrompt ?? '';
    const activeSkills = personaConfig?.skillIds && personaConfig.skillIds.length > 0
      ? await this.skillsService.findByIds(personaConfig.skillIds)
      : [];

    const toolPolicyRequest: ToolPolicyRequest = profile.runtimeKind === 'chat'
      ? {
          runtimeKind: 'chat',
          personaId: profile.personaId,
          ...(profile.toolPolicyRequest ?? {}),
        }
      : profile.toolPolicyRequest;

    const toolPolicy = await this.toolPolicy.decide(toolPolicyRequest);
    const warnings = [...toolPolicy.warnings];

    if (profile.runtimeKind === 'chat') {
      const effectiveSystemPrompt = systemPrompt
        + buildSkillsSection(activeSkills)
        + buildToolsSection(toolPolicy.tools, { includeCount: true });

      return {
        personaConfig,
        model: personaConfig?.model ?? '',
        systemPrompt,
        effectiveSystemPrompt,
        toolMetas: toolPolicy.tools,
        toolPolicy,
        activeSkills,
        runtimeKind: 'chat',
        warnings,
      };
    }

    const basePrompt = systemPrompt
      ? `${systemPrompt}\n\n${SUBAGENT_SYSTEM_PROMPT}`
      : SUBAGENT_SYSTEM_PROMPT;
    const branchAdditions = profile.runtimeKind === 'agent-flow-branch'
      ? (profile.systemPromptAdditions?.trim() ? `\n\n${profile.systemPromptAdditions.trim()}` : '')
      : '';
    const effectiveSystemPrompt = `${basePrompt}${branchAdditions}`
      + buildSkillsSection(activeSkills)
      + buildToolsSection(toolPolicy.tools, { compact: true, includeCount: false });
    const model = profile.runtimeKind === 'agent-flow-branch'
      ? (profile.modelOverride?.trim() || personaConfig?.model || '')
      : (personaConfig?.model ?? '');

    return {
      personaConfig,
      model,
      systemPrompt,
      effectiveSystemPrompt,
      toolMetas: toolPolicy.tools,
      toolPolicy,
      activeSkills,
      runtimeKind: profile.runtimeKind,
      warnings,
    };
  }
}
