import { Injectable } from '@nestjs/common';
import type { ToolCallRequest, MCPPolicy } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { PersonaService } from '../../persona/persona.service';

@Injectable()
@Tool({
  name: 'persona_list',
  description: 'List all personas. Returns id, name, model, allowedTools (native tool names), skillIds, and mcpPolicy for each.',
  parameters: {
    type: 'object',
    properties: {},
  },
  requiresConfirmation: false,
})
export class PersonaListTool {
  constructor(private readonly personaService: PersonaService) {}

  async execute(_request: ToolCallRequest): Promise<{ personas: { id: string; name: string; model: string; allowedTools: string[]; skillIds: string[]; mcpPolicy: MCPPolicy }[] }> {
    const all = await this.personaService.findAll();
    return {
      personas: all.map((p) => ({ id: p.id, name: p.name, model: p.model, allowedTools: p.allowedTools, skillIds: p.skillIds, mcpPolicy: p.mcpPolicy })),
    };
  }
}

@Injectable()
@Tool({
  name: 'persona_create',
  description: 'Create a new persona. A persona defines an AI identity with its own system prompt, model, and set of available native tools.',
  parameters: {
    type: 'object',
    required: ['name', 'systemPrompt', 'model'],
    properties: {
      name: { type: 'string', description: 'Display name for the persona (e.g. "Code Reviewer").' },
      systemPrompt: { type: 'string', description: 'The system prompt that defines this persona\'s behaviour and expertise.' },
      model: { type: 'string', description: 'LLM model identifier to use for this persona (e.g. "claude-sonnet-4-6").' },
      allowedTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of native tool names this persona is allowed to use. Empty = all tools. Use list_tools to discover tool names.',
      },
      skillIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of Skill entity IDs whose prompts are injected into the system prompt. Use skill_list to discover skill IDs.',
      },
      mcpPolicy: {
        type: 'string',
        enum: ['allow_all', 'deny_all', 'allow_list'],
        description: 'MCP server policy for this persona. Defaults to "allow_all".',
      },
    },
  },
  requiresConfirmation: true,
})
export class PersonaCreateTool {
  constructor(private readonly personaService: PersonaService) {}

  async execute(request: ToolCallRequest): Promise<{ id: string; name: string; model: string }> {
    const name = request.args['name'] as string;
    const systemPrompt = request.args['systemPrompt'] as string;
    const model = request.args['model'] as string;
    const allowedTools = (request.args['allowedTools'] as string[] | undefined) ?? [];
    const skillIds = (request.args['skillIds'] as string[] | undefined) ?? [];
    const mcpPolicy = (request.args['mcpPolicy'] as MCPPolicy | undefined) ?? 'allow_all';
    const persona = await this.personaService.create({ name, systemPrompt, model, allowedTools, skillIds, mcpPolicy });
    return { id: persona.id, name: persona.name, model: persona.model };
  }
}

@Injectable()
@Tool({
  name: 'persona_update',
  description: 'Update an existing persona by its ID. All fields are optional — only provided fields will be changed.',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'The ID of the persona to update. Use persona_list to find IDs.' },
      name: { type: 'string', description: 'New display name.' },
      systemPrompt: { type: 'string', description: 'New system prompt text.' },
      model: { type: 'string', description: 'New model identifier.' },
      allowedTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'New list of native tool names (replaces existing list entirely). Empty array = all tools allowed.',
      },
      skillIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'New list of Skill entity IDs whose prompts are injected into the system prompt (replaces existing list).',
      },
      mcpPolicy: {
        type: 'string',
        enum: ['allow_all', 'deny_all', 'allow_list'],
        description: 'New MCP policy.',
      },
    },
  },
  requiresConfirmation: true,
})
export class PersonaUpdateTool {
  constructor(private readonly personaService: PersonaService) {}

  async execute(request: ToolCallRequest): Promise<{ id: string; name: string; model: string }> {
    const id = request.args['id'] as string;
    const name = request.args['name'] as string | undefined;
    const systemPrompt = request.args['systemPrompt'] as string | undefined;
    const model = request.args['model'] as string | undefined;
    const allowedTools = request.args['allowedTools'] as string[] | undefined;
    const skillIds = request.args['skillIds'] as string[] | undefined;
    const mcpPolicy = request.args['mcpPolicy'] as MCPPolicy | undefined;
    const updated = await this.personaService.update(id, { name, systemPrompt, model, allowedTools, skillIds, mcpPolicy });
    return { id: updated.id, name: updated.name, model: updated.model };
  }
}

@Injectable()
@Tool({
  name: 'persona_delete',
  description: 'Permanently delete a persona by its ID.',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'The ID of the persona to delete. Use persona_list to find IDs.' },
    },
  },
  requiresConfirmation: true,
})
export class PersonaDeleteTool {
  constructor(private readonly personaService: PersonaService) {}

  async execute(request: ToolCallRequest): Promise<{ deleted: boolean; id: string }> {
    const id = request.args['id'] as string;
    await this.personaService.remove(id);
    return { deleted: true, id };
  }
}
