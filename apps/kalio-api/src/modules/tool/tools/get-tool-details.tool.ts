import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';

@Injectable()
@Tool({
  name: 'get_tool_details',
  description:
    'Returns full parameter schemas for the specified tools. ' +
    'Use after list_tools when you need to know exact parameter names and types before calling a tool.',
  parameters: {
    type: 'object',
    properties: {
      tool_names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names of tools to fetch details for',
      },
    },
    required: ['tool_names'],
  },
  requiresConfirmation: false,
})
export class GetToolDetailsTool {
  async execute(request: ToolCallRequest): Promise<{ details: string[]; errors: string[] }> {
    const toolNames = request.args['tool_names'] as string[];
    const available = request.availableTools ?? [];
    const byName = new Map(available.map(t => [t.name, t]));

    const details: string[] = [];
    const errors: string[] = [];

    for (const name of toolNames) {
      const tool = byName.get(name);
      if (!tool) {
        errors.push(`Unknown tool: ${name}`);
        continue;
      }

      const props = (tool.parameters as Record<string, unknown>)['properties'] as
        | Record<string, { type?: string; description?: string; enum?: unknown[] }>
        | undefined;
      const required = new Set(
        ((tool.parameters as Record<string, unknown>)['required'] as string[] | undefined) ?? [],
      );

      const paramLines =
        props != null
          ? Object.entries(props).map(([k, v]) => {
              const typeHint = v.enum
                ? `enum(${v.enum.slice(0, 3).join('|')})`
                : (v.type ?? 'any');
              const req = required.has(k) ? '*' : '';
              return `  ${req}${k}: ${typeHint} — ${v.description ?? ''}`;
            })
          : [];

      details.push(
        `### ${tool.name}\n${tool.description}\nParameters:\n${paramLines.join('\n') || '  (none)'}`,
      );
    }

    return { details, errors };
  }
}
