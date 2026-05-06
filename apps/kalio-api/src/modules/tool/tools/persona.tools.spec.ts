import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { PersonaCreateTool } from './persona.tools';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';

describe('PersonaCreateTool metadata', () => {
  const reflector = new Reflector();

  it('REGRESSION: requires confirmation because it creates persistent persona state', () => {
    const metadata = reflector.get(TOOL_METADATA, PersonaCreateTool);

    expect(metadata.requiresConfirmation).toBe(true);
  });
});