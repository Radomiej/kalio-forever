import { Injectable } from '@nestjs/common';
import type { MCPPolicy, PersonaSessionConfig, Skill, ToolMeta } from '@kalio/types';
import { PersonaService } from '../persona/persona.service';
import { SkillsService } from '../skills/skills.service';
import { ToolDispatchService } from './tool-dispatch.service';

export interface AssembledContext {
  personaConfig: PersonaSessionConfig | null;
  model: string;
  systemPrompt: string;
  effectiveSystemPrompt: string;
  toolMetas: ToolMeta[];
  activeSkills: Skill[];
}

@Injectable()
export class ContextAssemblyService {
  constructor(
    private readonly personaService: PersonaService,
    private readonly skillsService: SkillsService,
    private readonly toolDispatch: ToolDispatchService,
  ) {}

  async assemble(personaId: string): Promise<AssembledContext> {
    const personaConfig = await this.personaService.getSessionConfig(personaId);
    const systemPrompt = personaConfig?.systemPrompt ?? '';
    const allToolMetas = this.toolDispatch.getToolMetas();
    const toolMetas = this.filterTools(
      allToolMetas,
      personaConfig?.allowedTools,
      personaConfig?.mcpPolicy ?? 'allow_all',
    );
    const skillIds = personaConfig?.skillIds ?? [];
    const activeSkills = skillIds.length > 0
      ? await this.skillsService.findByIds(skillIds)
      : [];
    const skillsSection = activeSkills.length > 0
      ? `\n\n## Active skills\n` +
        activeSkills.map((skill) => `### ${skill.name}\n${skill.description}\n\n${skill.prompt}`).join('\n\n')
      : '';
    const toolsSection = toolMetas.length > 0
      ? `\n\n## Available tools (${toolMetas.length})\n` +
        toolMetas.map((toolMeta) => {
          const desc = toolMeta.description.length > 80
            ? toolMeta.description.slice(0, 79) + '...'
            : toolMeta.description;
          return `- ${toolMeta.name}: ${desc}`;
        }).join('\n')
      : '';

    return {
      personaConfig,
      model: personaConfig?.model ?? '',
      systemPrompt,
      effectiveSystemPrompt: systemPrompt + skillsSection + toolsSection,
      toolMetas,
      activeSkills,
    };
  }

  private filterTools(tools: ToolMeta[], allowedTools?: string[], mcpPolicy: MCPPolicy = 'allow_all'): ToolMeta[] {
    const nativeTools = tools.filter((toolMeta) => !toolMeta.name.startsWith('mcp_'));
    const mcpTools = tools.filter((toolMeta) => toolMeta.name.startsWith('mcp_'));
    const filteredNative = !allowedTools || allowedTools.length === 0
      ? nativeTools
      : nativeTools.filter((toolMeta) => allowedTools.includes(toolMeta.name));

    let filteredMcp: ToolMeta[];
    if (mcpPolicy === 'allow_all') {
      filteredMcp = mcpTools;
    } else if (mcpPolicy === 'deny_all') {
      filteredMcp = [];
    } else {
      const toolSet = new Set(allowedTools ?? []);
      filteredMcp = mcpTools.filter((toolMeta) => toolSet.has(toolMeta.name));
    }

    return [...filteredNative, ...filteredMcp];
  }
}
