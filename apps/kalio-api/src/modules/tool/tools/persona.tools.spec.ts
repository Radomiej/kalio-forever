import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { PersonaCreateTool, PersonaUpdateTool, PersonaDeleteTool } from './persona.tools';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';
import type { ToolCallRequest } from '@kalio/types';

function makeRequest(toolName: string, args: Record<string, unknown>): ToolCallRequest {
  return {
    callId: 'call-persona',
    sessionId: 'sess-persona',
    toolName,
    args,
  };
}

describe('PersonaCreateTool metadata', () => {
  const reflector = new Reflector();

  it('REGRESSION: requires confirmation because it creates persistent persona state', () => {
    const metadata = reflector.get(TOOL_METADATA, PersonaCreateTool);

    expect(metadata.requiresConfirmation).toBe(true);
  });
});

describe('Persona tools validation regressions', () => {
  let personaService: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let createTool: PersonaCreateTool;
  let updateTool: PersonaUpdateTool;
  let deleteTool: PersonaDeleteTool;

  beforeEach(() => {
    personaService = {
      create: vi.fn().mockResolvedValue({ id: 'persona-1', name: 'Builder', model: 'gpt-4.1' }),
      update: vi.fn().mockResolvedValue({ id: 'persona-1', name: 'Builder', model: 'gpt-4.1' }),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    createTool = new PersonaCreateTool(personaService as never);
    updateTool = new PersonaUpdateTool(personaService as never);
    deleteTool = new PersonaDeleteTool(personaService as never);
  });

  it.each([
    {
      label: 'name is empty',
      args: { name: '', systemPrompt: 'Help users', model: 'gpt-4.1' },
      error: 'INVALID_NAME',
    },
    {
      label: 'systemPrompt is whitespace',
      args: { name: 'Builder', systemPrompt: '   ', model: 'gpt-4.1' },
      error: 'INVALID_SYSTEM_PROMPT',
    },
    {
      label: 'model is numeric',
      args: { name: 'Builder', systemPrompt: 'Help users', model: 42 },
      error: 'INVALID_MODEL',
    },
    {
      label: 'allowedTools is not an array',
      args: { name: 'Builder', systemPrompt: 'Help users', model: 'gpt-4.1', allowedTools: 'vfs_read' },
      error: 'INVALID_ALLOWED_TOOLS',
    },
  ])('persona_create rejects malformed input when $label (REGRESSION)', async ({ args, error }) => {
    await expect(createTool.execute(makeRequest('persona_create', args))).rejects.toThrow(error);
    expect(personaService.create).not.toHaveBeenCalled();
  });

  it('persona_update rejects whitespace-only id (REGRESSION)', async () => {
    await expect(
      updateTool.execute(makeRequest('persona_update', { id: '   ', name: 'New name' })),
    ).rejects.toThrow('INVALID_ID');

    expect(personaService.update).not.toHaveBeenCalled();
  });

  it('persona_delete rejects numeric id (REGRESSION)', async () => {
    await expect(
      deleteTool.execute(makeRequest('persona_delete', { id: 123 })),
    ).rejects.toThrow('INVALID_ID');

    expect(personaService.remove).not.toHaveBeenCalled();
  });
});