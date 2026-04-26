import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { LLMService } from '../../llm/llm.service';

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

  private getToolRegistry(): any {
    return this.moduleRef.get('ToolRegistryService');
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
    let tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
    if (availableTools && availableTools.length > 0) {
      tools = this.getToolRegistry().getToolsForSkills(availableTools);
    } else {
      tools = this.getToolRegistry().getAllTools();
    }

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
