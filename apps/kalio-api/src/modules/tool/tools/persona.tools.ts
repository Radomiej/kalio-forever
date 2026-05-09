import { Injectable } from '@nestjs/common';
import type { ToolCallRequest, MCPPolicy } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { PersonaService } from '../../persona/persona.service';

function getRequiredStringArg(args: ToolCallRequest['args'], key: 'name' | 'systemPrompt' | 'model' | 'id'): string {
  const rawValue = args[key];
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    const errorKey = key === 'systemPrompt' ? 'INVALID_SYSTEM_PROMPT' : key === 'id' ? 'INVALID_ID' : `INVALID_${key.toUpperCase()}`;
    throw new Error(`${errorKey}: ${key} must be a non-empty string`);
  }
  return rawValue.trim();
}

function getOptionalStringArg(args: ToolCallRequest['args'], key: 'name' | 'systemPrompt' | 'model'): string | undefined {
  const rawValue = args[key];
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    const errorKey = key === 'systemPrompt' ? 'INVALID_SYSTEM_PROMPT' : `INVALID_${key.toUpperCase()}`;
    throw new Error(`${errorKey}: ${key} must be a non-empty string`);
  }
  return rawValue.trim();
}

function getOptionalStringArrayArg(args: ToolCallRequest['args'], key: 'allowedTools' | 'skillIds'): string[] | undefined {
  const rawValue = args[key];
  if (rawValue === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawValue) || rawValue.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error(`INVALID_${key === 'allowedTools' ? 'ALLOWED_TOOLS' : 'SKILL_IDS'}: ${key} must be an array of non-empty strings`);
  }
  return rawValue.map((item) => item.trim());
}

function getOptionalMcpPolicyArg(args: ToolCallRequest['args']): MCPPolicy | undefined {
  const rawValue = args['mcpPolicy'];
  if (rawValue === undefined) {
    return undefined;
  }
  if (rawValue !== 'allow_all' && rawValue !== 'deny_all' && rawValue !== 'allow_list') {
    throw new Error('INVALID_MCP_POLICY: mcpPolicy must be one of "allow_all", "deny_all", or "allow_list"');
  }
  return rawValue;
}

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
    const name = getRequiredStringArg(request.args, 'name');
    const systemPrompt = getRequiredStringArg(request.args, 'systemPrompt');
    const model = getRequiredStringArg(request.args, 'model');
    const allowedTools = getOptionalStringArrayArg(request.args, 'allowedTools') ?? [];
    const skillIds = getOptionalStringArrayArg(request.args, 'skillIds') ?? [];
    const mcpPolicy = getOptionalMcpPolicyArg(request.args) ?? 'allow_all';
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
    const id = getRequiredStringArg(request.args, 'id');
    const name = getOptionalStringArg(request.args, 'name');
    const systemPrompt = getOptionalStringArg(request.args, 'systemPrompt');
    const model = getOptionalStringArg(request.args, 'model');
    const allowedTools = getOptionalStringArrayArg(request.args, 'allowedTools');
    const skillIds = getOptionalStringArrayArg(request.args, 'skillIds');
    const mcpPolicy = getOptionalMcpPolicyArg(request.args);
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
    const id = getRequiredStringArg(request.args, 'id');
    await this.personaService.remove(id);
    return { deleted: true, id };
  }
}
