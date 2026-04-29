import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { ToolCallRequest, ToolMeta } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { LLMService } from '../../llm/llm.service';
// eslint-disable-next-line import/no-cycle
import { ToolRegistryService } from '../tool-registry.service';

interface ToolRegistryLike {
  getEntries?: () => Array<{ meta: ToolMeta }>;
  getAllTools?: () => ToolMeta[];
  getToolsForSkills?: (skills: string[]) => ToolMeta[];
}

const SUBAGENT_SYSTEM_PROMPT = `You are a focused sub-agent completing a single specific task.
Act immediately — call tools if available, return a clear result.
Do NOT ask clarifying questions. Work autonomously end-to-end.
Reply with your result only — no preamble.`;

@Injectable()
@Tool({
  name: 'run_subagent',
  description:
    'Spawn a focused sub-agent to complete a specific task using LLM reasoning. ' +
    'Best for self-contained tasks: summarisation, analysis, drafting content, answering questions. ' +
    'Returns the sub-agent result as text.',
  parameters: {
    type: 'object',
    required: ['objective'],
    properties: {
      objective: {
        type: 'string',
        description: 'Clear, specific task description for the sub-agent to complete.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Max execution time in milliseconds. Default: 60000. Max: 180000.',
      },
      availableTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of tool names to make available to the sub-agent. If not provided, all tools are available.',
      },
    },
  },
})
export class SubagentTool {
  private readonly logger = new Logger(SubagentTool.name);

  constructor(
    private readonly llm: LLMService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private getToolRegistry(): ToolRegistryLike {
    // Use the class as the DI token (not a string) so NestJS can resolve it.
    // { strict: false } searches the entire application graph, which is needed
    // because ToolRegistryService and SubagentTool are in the same module but
    // the default strict lookup fails with a class-keyed provider.
    return this.moduleRef.get(ToolRegistryService, { strict: false });
  }

  private getTools(availableTools?: string[]): ToolMeta[] {
    const registry = this.getToolRegistry();

    if (availableTools && availableTools.length > 0) {
      if (typeof registry.getToolsForSkills === 'function') {
        return registry.getToolsForSkills(availableTools);
      }
      if (typeof registry.getEntries === 'function') {
        const allowed = new Set(availableTools);
        return registry
          .getEntries()
          .map((entry) => entry.meta)
          .filter((meta) => allowed.has(meta.name));
      }
    }

    if (typeof registry.getAllTools === 'function') {
      return registry.getAllTools();
    }
    if (typeof registry.getEntries === 'function') {
      return registry.getEntries().map((entry) => entry.meta);
    }

    throw new Error('ToolRegistryService does not expose a supported tool listing API');
  }

  async execute(request: ToolCallRequest): Promise<{ result: string; taskId: string }> {
    const objective = request.args['objective'] as string;
    const rawTimeout = request.args['timeoutMs'] as number | undefined;
    const availableTools = request.args['availableTools'] as string[] | undefined;
    const timeoutMs = Math.min(rawTimeout ?? 60_000, 180_000);
    const taskId = randomUUID();
    const sessionId = request.sessionId;
    const messageId = `subagent-${taskId}`;

    this.logger.log(`[run_subagent] Starting task ${taskId}: ${objective.slice(0, 80)}`);

    const chunks: string[] = [];

    // Get tools: use availableTools if provided, otherwise all tools
    const tools = this.getTools(availableTools);

    const runPromise = this.llm.streamChat(
      [
        { role: 'system', content: SUBAGENT_SYSTEM_PROMPT },
        { role: 'user', content: objective },
      ],
      tools,
      (chunk) => {
        if (!chunk.done && !chunk.thinking) {
          chunks.push(chunk.delta);
        }
      },
      sessionId,
      messageId,
    );

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Sub-agent timed out after ${timeoutMs}ms`)), timeoutMs),
    );

    await Promise.race([runPromise, timeoutPromise]);

    const result = chunks.join('').trim() || 'Sub-agent completed with no output.';
    this.logger.log(`[run_subagent] Done ${taskId}, length=${result.length}`);

    return { result, taskId };
  }
}
