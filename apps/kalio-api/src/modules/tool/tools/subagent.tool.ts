import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { SubagentToolResult, ToolCallRequest, ToolMeta, VFSMode } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
// eslint-disable-next-line import/no-cycle
import { ToolRegistryService } from '../tool-registry.service';
import { SUBAGENT_RUNTIME, type SubagentRuntimePort } from '../subagent-runtime.port';

interface ToolRegistryLike {
  getEntries?: () => Array<{ meta: ToolMeta }>;
  getAllTools?: () => ToolMeta[];
  getToolsForSkills?: (skills: string[]) => ToolMeta[];
}

function buildDelegatedRequest(
  request: ToolCallRequest,
  args: Record<string, unknown>,
): ToolCallRequest {
  return {
    ...request,
    toolName: 'run_subagent',
    args,
  };
}

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
      childSessionId: {
        type: 'string',
        description: 'Optional existing sub-agent session id. When provided, send the objective as the next user message into that chat instead of creating a new one.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Max execution time in milliseconds. Default: 60000. Max: 180000.',
      },
      availableTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of tool names to make available to the sub-agent. Omit this to give the child the full toolset. If you restrict it, include every required capability, such as vfs_write for file creation or image_view for image inspection.',
      },
      personaId: {
        type: 'string',
        description: 'Optional specialist persona id for the sub-agent. Set this explicitly when delegating to a known specialist such as web-research, designer, or dev. Defaults to default.',
      },
      vfsMode: {
        type: 'string',
        enum: ['isolated', 'shared'],
        description: 'VFS mode for the sub-agent. isolated = private child VFS copied back on completion; shared = child reads and writes the parent VFS directly. Use shared when the child must inspect or modify files already present in the parent VFS or produced by earlier child agents.',
      },
      copyOutputs: {
        type: 'boolean',
        description: 'When true, copy isolated child VFS files back into the master VFS. Default: true.',
      },
    },
  },
})
export class SubagentTool {
  private readonly logger = new Logger(SubagentTool.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  private getToolRegistry(): ToolRegistryLike {
    // Use the class as the DI token (not a string) so NestJS can resolve it.
    // { strict: false } searches the entire application graph, which is needed
    // because ToolRegistryService and SubagentTool are in the same module but
    // the default strict lookup fails with a class-keyed provider.
    return this.moduleRef.get(ToolRegistryService, { strict: false });
  }

  private getRuntime(): SubagentRuntimePort {
    try {
      const candidate = this.moduleRef.get(SUBAGENT_RUNTIME, { strict: false }) as unknown;
      if (this.isRuntime(candidate)) return candidate;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.debug(`[run_subagent] Runtime unavailable: ${error.message}`);
    }
    throw new Error('Subagent runtime is unavailable');
  }

  private isRuntime(value: unknown): value is SubagentRuntimePort {
    return typeof value === 'object'
      && value !== null
      && 'runSubagent' in value
      && typeof (value as { runSubagent?: unknown }).runSubagent === 'function';
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

  async execute(request: ToolCallRequest): Promise<SubagentToolResult> {
    const objective = request.args['objective'] as string;
    const childSessionId = typeof request.args['childSessionId'] === 'string'
      ? request.args['childSessionId']
      : undefined;
    const rawTimeout = request.args['timeoutMs'] as number | undefined;
    const availableTools = request.args['availableTools'] as string[] | undefined;
    const personaId = request.args['personaId'] as string | undefined;
    const rawVfsMode = request.args['vfsMode'];
    const vfsMode: VFSMode = rawVfsMode === 'shared' ? 'shared' : 'isolated';
    const copyOutputs = request.args['copyOutputs'] !== false;
    const timeoutMs = Math.min(rawTimeout ?? 60_000, 180_000);
    const taskId = randomUUID();
    const sessionId = request.sessionId;
    this.logger.log(`[run_subagent] Starting task ${taskId}: ${objective.slice(0, 80)}`);

    // Get tools: use availableTools if provided, otherwise all tools
    const tools = this.getTools(availableTools);
    const runtime = this.getRuntime();
    return runtime.runSubagent({
      parentSessionId: sessionId,
      parentToolCallId: request.callId,
      objective,
      childSessionId,
      personaId,
      availableTools: tools,
      timeoutMs,
      vfsMode,
      copyOutputs,
      emit: request._emit,
      parentAgentRun: request.agentRun,
    });
  }
}

@Injectable()
@Tool({
  name: 'spawn_subagent',
  description:
    'Spawn a new focused sub-agent chat for a specific task. ' +
    'Use this when you want an explicit new child session rather than continuing an existing one.',
  parameters: {
    type: 'object',
    required: ['objective'],
    properties: {
      objective: {
        type: 'string',
        description: 'Clear, specific task description for the new sub-agent to complete.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Max execution time in milliseconds. Default: 60000. Max: 180000.',
      },
      availableTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of tool names to make available to the sub-agent. Omit this to give the child the full toolset. If you restrict it, include every required capability, such as vfs_write for file creation or image_view for image inspection.',
      },
      personaId: {
        type: 'string',
        description: 'Optional specialist persona id for the new sub-agent. Set this explicitly when delegating to a known specialist such as web-research, designer, or dev. Defaults to default.',
      },
      vfsMode: {
        type: 'string',
        enum: ['isolated', 'shared'],
        description: 'VFS mode for the sub-agent. isolated = private child VFS copied back on completion; shared = child reads and writes the parent VFS directly. Use shared when the child must inspect or modify files already present in the parent VFS or produced by earlier child agents.',
      },
      copyOutputs: {
        type: 'boolean',
        description: 'When true, copy isolated child VFS files back into the master VFS. Default: true.',
      },
    },
  },
})
export class SpawnSubagentTool {
  constructor(private readonly subagentTool: SubagentTool) {}

  async execute(request: ToolCallRequest): Promise<SubagentToolResult> {
    const { childSessionId: _ignored, ...restArgs } = request.args;
    return this.subagentTool.execute(buildDelegatedRequest(request, restArgs));
  }
}

@Injectable()
@Tool({
  name: 'message_subagent',
  description:
    'Send the next message into an existing focused sub-agent chat. ' +
    'Use this when you already have a childSessionId and want that same child to continue.',
  parameters: {
    type: 'object',
    required: ['objective', 'childSessionId'],
    properties: {
      objective: {
        type: 'string',
        description: 'Clear, specific follow-up message for the existing sub-agent chat.',
      },
      childSessionId: {
        type: 'string',
        description: 'Existing sub-agent session id to continue.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Max execution time in milliseconds. Default: 60000. Max: 180000.',
      },
      availableTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of tool names to make available to the sub-agent. Omit this to give the child the full toolset. If you restrict it, include every required capability, such as vfs_write for file creation or image_view for image inspection.',
      },
      personaId: {
        type: 'string',
        description: 'Optional specialist persona override for the continued sub-agent turn. Set this explicitly when delegating to a known specialist such as web-research, designer, or dev.',
      },
      vfsMode: {
        type: 'string',
        enum: ['isolated', 'shared'],
        description: 'VFS mode for the sub-agent. isolated = private child VFS copied back on completion; shared = child reads and writes the parent VFS directly. Use shared when the child must inspect or modify files already present in the parent VFS or produced by earlier child agents.',
      },
      copyOutputs: {
        type: 'boolean',
        description: 'When true, copy isolated child VFS files back into the master VFS. Default: true.',
      },
    },
  },
})
export class MessageSubagentTool {
  constructor(private readonly subagentTool: SubagentTool) {}

  async execute(request: ToolCallRequest): Promise<SubagentToolResult> {
    const childSessionId = typeof request.args['childSessionId'] === 'string'
      ? request.args['childSessionId'].trim()
      : '';

    if (!childSessionId) {
      throw new Error('message_subagent requires childSessionId');
    }

    return this.subagentTool.execute(buildDelegatedRequest(request, {
      ...request.args,
      childSessionId,
    }));
  }
}
