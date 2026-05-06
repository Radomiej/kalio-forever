import { SetMetadata } from '@nestjs/common';

export const TOOL_METADATA = 'tool:metadata';

export interface ToolOptions {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  requiresConfirmation?: boolean;
}

export const Tool = (options: ToolOptions): ClassDecorator =>
  SetMetadata(TOOL_METADATA, {
    ...options,
    requiresConfirmation: options.requiresConfirmation ?? false,
  });

export type ConfirmedToolOptions = Omit<ToolOptions, 'requiresConfirmation'>;

export const ConfirmedTool = (options: ConfirmedToolOptions): ClassDecorator =>
  Tool({
    ...options,
    requiresConfirmation: true,
  });
