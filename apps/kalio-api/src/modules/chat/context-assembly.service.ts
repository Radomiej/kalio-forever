import { Injectable } from '@nestjs/common';
import type { PersonaSessionConfig, SessionRuntimeContext, SessionRuntimeKind, Skill, ToolMeta, ToolPolicyDecision } from '@kalio/types';
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

  async assembleForSessionRuntime(
    personaId: string,
    runtimeContext: SessionRuntimeContext,
  ): Promise<AssembledContext> {
    if (
      runtimeContext.runtimeKind === 'chat'
      || runtimeContext.runtimeKind === 'agent-flow-root'
      || runtimeContext.runtimeKind === 'cli-agent'
    ) {
      return this.assembleForRuntime({
        runtimeKind: 'chat',
        personaId,
        toolPolicyRequest: {
          runtimeKind: runtimeContext.runtimeKind === 'chat' ? 'chat' : runtimeContext.runtimeKind,
          personaId,
          sessionRuntimeContext: runtimeContext,
          architectureContext: runtimeContext.architectureContext,
        },
      });
    }

    const toolPolicyRequest: ToolPolicyRequest = {
      runtimeKind: runtimeContext.runtimeKind,
      personaId,
      sessionRuntimeContext: runtimeContext,
      explicitToolNames: runtimeContext.explicitToolNames,
      architectureContext: runtimeContext.architectureContext,
    };

    if (runtimeContext.runtimeKind === 'agent-flow-branch') {
      toolPolicyRequest.slotPolicy = runtimeContext.architectureSlotPolicy;
      return this.assembleForRuntime({
        runtimeKind: 'agent-flow-branch',
        personaId,
        toolPolicyRequest,
        modelOverride: runtimeContext.modelOverride,
      });
    }

    return this.assembleForRuntime({
      runtimeKind: 'subagent',
      personaId,
      toolPolicyRequest,
    });
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
    const launchScopePrompt = buildLaunchScopePrompt(
      toolPolicyRequest.architectureContext ?? toolPolicyRequest.sessionRuntimeContext?.architectureContext,
    );
    const raAppLaunchPrompt = buildRaAppLaunchPrompt(
      toolPolicyRequest.architectureContext ?? toolPolicyRequest.sessionRuntimeContext?.architectureContext,
    );

    if (profile.runtimeKind === 'chat') {
      const effectiveSystemPrompt = joinPromptSections([
        systemPrompt,
        launchScopePrompt,
        raAppLaunchPrompt,
        buildSkillsSection(activeSkills),
        buildToolsSection(toolPolicy.tools, { includeCount: true }),
      ]);

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

function joinPromptSections(sections: string[]): string {
  return sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join('\n\n');
}

function buildLaunchScopePrompt(architectureContext: Record<string, unknown> | undefined): string {
  const projectPath = normalizeLaunchScopePath(architectureContext);
  if (!projectPath) {
    return '';
  }

  const executionCwd = typeof architectureContext?.['executionCwd'] === 'string'
    ? architectureContext['executionCwd'].trim()
    : '';

  const scopeLines = [
    '## Launch scope',
    `Local project path: ${projectPath}`,
    'Treat this path as the default host project root for file inspection, edits, and terminal checks in this chat.',
    'If you need project evidence, start from this path before assuming another repo or working directory.',
  ];
  if (executionCwd && executionCwd !== projectPath) {
    scopeLines.push(`Execution working directory: ${executionCwd}`);
  }
  return scopeLines.join('\n');
}

function normalizeLaunchScopePath(architectureContext: Record<string, unknown> | undefined): string {
  const projectPath = architectureContext?.['projectPath'];
  if (typeof projectPath === 'string' && projectPath.trim().length > 0) {
    return projectPath.trim();
  }
  const executionCwd = architectureContext?.['executionCwd'];
  if (typeof executionCwd === 'string' && executionCwd.trim().length > 0) {
    return executionCwd.trim();
  }
  return '';
}

function buildRaAppLaunchPrompt(architectureContext: Record<string, unknown> | undefined): string {
  const appId = typeof architectureContext?.['raAppLaunchId'] === 'string'
    ? architectureContext['raAppLaunchId'].trim()
    : '';
  if (!appId) {
    return '';
  }

  const appName = typeof architectureContext?.['raAppLaunchName'] === 'string'
    ? architectureContext['raAppLaunchName'].trim()
    : '';

  return [
    '## RA-App launch',
    `The user already selected the stored RA-App ${appName ? `"${appName}"` : 'for this turn'}.`,
    `Use run_raapp with the exact id "${appId}" on the first launch call in this session.`,
    'Do not switch to another RA-App id unless this exact id is unavailable.',
  ].join('\n');
}
