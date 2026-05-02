import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { SkillsService } from '../../skills/skills.service';

@Injectable()
@Tool({
  name: 'skill_list',
  description: 'List all skills. Optionally filter by source ("user" or "agent"). Returns id, name, description, and source for each skill.',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['user', 'agent'],
        description: 'Optional filter â€” only return skills created by this source.',
      },
    },
  },
  requiresConfirmation: false,
})
export class SkillListTool {
  constructor(private readonly skillsService: SkillsService) {}

  async execute(request: ToolCallRequest): Promise<{ skills: { id: string; name: string; description: string; source: string }[] }> {
    const source = request.args['source'] as string | undefined;
    const all = await this.skillsService.findAll();
    const filtered = source ? all.filter((s) => s.source === source) : all;
    return {
      skills: filtered.map((s) => ({ id: s.id, name: s.name, description: s.description, source: s.source })),
    };
  }
}

@Injectable()
@Tool({
  name: 'skill_read',
  description: 'Read the full details of a skill including its prompt text. Look up by ID or name. Use this to inspect what instructions a skill injects into the system prompt.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The exact ID of the skill to read. Takes precedence over name.' },
      name: { type: 'string', description: 'The name of the skill to read (case-insensitive). Used when id is not provided.' },
    },
  },
  requiresConfirmation: false,
})
export class SkillReadTool {
  constructor(private readonly skillsService: SkillsService) {}

  async execute(request: ToolCallRequest): Promise<{ id: string; name: string; description: string; prompt: string; source: string }> {
    const id = request.args['id'] as string | undefined;
    const name = request.args['name'] as string | undefined;
    let skill = id ? await this.skillsService.findOne(id) : undefined;
    if (!skill && name) {
      const lower = name.toLowerCase();
      const all = await this.skillsService.findAll();
      skill = all.find((s) => s.name.toLowerCase() === lower) ?? null;
    }
    if (!skill) {
      throw new Error(`Skill not found: ${id ?? name ?? '(no id or name provided)'}`);
    }
    return { id: skill.id, name: skill.name, description: skill.description, prompt: skill.prompt, source: skill.source };
  }
}

@Injectable()
@Tool({
  name: 'skill_create',
  description: 'Create a new skill. A skill is a named prompt snippet that gets injected into the system prompt when active. The source will be set to "agent" automatically.',
  parameters: {
    type: 'object',
    required: ['name', 'description', 'prompt'],
    properties: {
      name: { type: 'string', description: 'Short unique name for the skill (e.g. "Python Expert").' },
      description: { type: 'string', description: 'One-sentence description of what this skill does.' },
      prompt: { type: 'string', description: 'The prompt text injected into the system prompt when this skill is active.' },
    },
  },
  requiresConfirmation: false,
})
export class SkillCreateTool {
  constructor(private readonly skillsService: SkillsService) {}

  async execute(request: ToolCallRequest): Promise<{ id: string; name: string; description: string; source: string }> {
    const name = request.args['name'] as string;
    const description = request.args['description'] as string;
    const prompt = request.args['prompt'] as string;
    const skill = await this.skillsService.create({ name, description, prompt, source: 'agent' });
    return { id: skill.id, name: skill.name, description: skill.description, source: skill.source };
  }
}

@Injectable()
@Tool({
  name: 'skill_update',
  description: 'Update an existing skill by its ID. All fields are optional â€” only provided fields will be changed.',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'The ID of the skill to update. Use skill_list to find IDs.' },
      name: { type: 'string', description: 'New name for the skill.' },
      description: { type: 'string', description: 'New description for the skill.' },
      prompt: { type: 'string', description: 'New prompt text for the skill.' },
    },
  },
  requiresConfirmation: true,
})
export class SkillUpdateTool {
  constructor(private readonly skillsService: SkillsService) {}

  async execute(request: ToolCallRequest): Promise<{ id: string; name: string; description: string }> {
    const id = request.args['id'] as string;
    const name = request.args['name'] as string | undefined;
    const description = request.args['description'] as string | undefined;
    const prompt = request.args['prompt'] as string | undefined;
    const updated = await this.skillsService.update(id, { name, description, prompt });
    if (!updated) throw new Error(`Skill ${id} not found`);
    return { id: updated.id, name: updated.name, description: updated.description };
  }
}

@Injectable()
@Tool({
  name: 'skill_delete',
  description: 'Permanently delete a skill by its ID.',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'The ID of the skill to delete. Use skill_list to find IDs.' },
    },
  },
  requiresConfirmation: true,
})
export class SkillDeleteTool {
  constructor(private readonly skillsService: SkillsService) {}

  async execute(request: ToolCallRequest): Promise<{ deleted: boolean; id: string }> {
    const id = request.args['id'] as string;
    await this.skillsService.remove(id);
    return { deleted: true, id };
  }
}
