import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';

@Injectable()
@Tool({
  name: 'list_tools',
  description:
    'Returns a compact list of all available tools (name + one-line description). ' +
    'Call this at the start of complex tasks to review what you can do. ' +
    'Use get_tool_details to fetch full parameter schemas for specific tools.',
  parameters: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        description: 'Optional substring to filter tool names (case-insensitive)',
      },
    },
    required: [],
  },
  requiresConfirmation: false,
})
export class ListToolsTool {
  async execute(request: ToolCallRequest): Promise<{ tools: string[]; count: number }> {
    const filter = request.args['filter'] as string | undefined;
    const available = request.availableTools ?? [];

    let tools = available.filter(t => t.name !== 'list_tools');

    if (filter) {
      const lower = filter.toLowerCase();
      tools = tools.filter(t => t.name.toLowerCase().includes(lower));
    }

    tools = [...tools].sort((a, b) => a.name.localeCompare(b.name));

    const lines = tools.map(t => {
      const desc =
        t.description.length > 80 ? t.description.slice(0, 79) + '…' : t.description;
      return `- ${t.name}: ${desc}`;
    });

    return { tools: lines, count: lines.length };
  }
}
