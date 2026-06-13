import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type {
  AgentFlowRunSnapshot,
  AgentFlowReturnMode,
  AgentFlowStartMode,
  RunSubAgentFlowArgs,
  SubAgentFlowResult,
  ToolCallRequest,
  VFSMode,
} from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { AGENT_FLOW_RUNTIME, type AgentFlowRuntimePort } from '../../agent-flow/agent-flow-runtime.port';

const MAX_STEPS = 50;

function getRequiredString(args: ToolCallRequest['args'], key: 'flowId' | 'goal'): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`INVALID_${key.toUpperCase()}: ${key} must be a non-empty string`);
  }
  return value.trim();
}

function getParentSessionId(request: ToolCallRequest): string {
  if (typeof request.sessionId !== 'string' || request.sessionId.trim().length === 0) {
    throw new Error('INVALID_PARENT_SESSION_ID: parent session id must be present');
  }
  return request.sessionId.trim();
}

function getContext(args: ToolCallRequest['args']): RunSubAgentFlowArgs['context'] {
  const value = args['context'];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('INVALID_CONTEXT: context must be a string or object');
}

function withLaunchAllowedToolNames(
  context: RunSubAgentFlowArgs['context'],
  request: ToolCallRequest,
): RunSubAgentFlowArgs['context'] {
  const launchAllowedToolNames = request.availableTools
    ?.map((tool) => tool?.name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
  if (!launchAllowedToolNames || launchAllowedToolNames.length === 0) {
    return context;
  }
  if (typeof context === 'string') {
    return {
      subAgentFlowContext: context,
      launchAllowedToolNames,
    };
  }
  return {
    ...(context ?? {}),
    launchAllowedToolNames,
  };
}

function getVfsMode(args: ToolCallRequest['args']): VFSMode {
  const value = args['vfsMode'];
  if (value === undefined) return 'isolated';
  if (value === 'isolated' || value === 'shared') return value;
  throw new Error('INVALID_VFS_MODE: vfsMode must be "isolated" or "shared"');
}

function getReturnMode(args: ToolCallRequest['args']): AgentFlowReturnMode {
  const value = args['returnMode'];
  if (value === undefined) return 'summary';
  if (value === 'summary' || value === 'full_trace' || value === 'artifacts_only') return value;
  throw new Error('INVALID_RETURN_MODE: returnMode must be "summary", "full_trace", or "artifacts_only"');
}

function getStartMode(args: ToolCallRequest['args']): AgentFlowStartMode {
  const value = args['startMode'];
  if (value === undefined) return 'durable';
  if (value === 'durable' || value === 'blocking') return value;
  throw new Error('INVALID_START_MODE: startMode must be "durable" or "blocking"');
}

function getCopyBack(args: ToolCallRequest['args']): boolean {
  const value = args['copyBack'];
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  throw new Error('INVALID_COPY_BACK: copyBack must be a boolean');
}

function getMaxSteps(args: ToolCallRequest['args']): number | undefined {
  const value = args['maxSteps'];
  if (value === undefined) return undefined;
  const numeric = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric < 1) {
    throw new Error('INVALID_MAX_STEPS: maxSteps must be a positive integer');
  }
  return Math.min(numeric, MAX_STEPS);
}

function resultFromSnapshot(
  snapshot: AgentFlowRunSnapshot,
  requestContext?: Pick<RunSubAgentFlowArgs, 'parentSessionId' | 'parentToolCallId'>,
): SubAgentFlowResult {
  const parentSessionId = snapshot.run.parentSessionId || requestContext?.parentSessionId;
  const parentToolCallId = snapshot.run.parentToolCallId ?? requestContext?.parentToolCallId;
  if (snapshot.result) {
    return {
      ...snapshot.result,
      parentSessionId,
      parentToolCallId,
      childSessionId: snapshot.run.childSessionId,
      openChatSessionId: snapshot.run.openChatSessionId ?? snapshot.result.openChatSessionId,
      openGraphRunId: snapshot.run.openGraphRunId ?? snapshot.result.openGraphRunId,
    };
  }
  return {
    flowRunId: snapshot.run.id,
    parentSessionId,
    parentToolCallId,
    childSessionId: snapshot.run.childSessionId,
    status: snapshot.run.status,
    summary: snapshot.run.summary ?? `AgentFlow ${snapshot.run.flowDefinitionId} started.`,
    decisions: [],
    nextActions: ['Open the child AgentFlow graph to monitor completion.'],
    artifacts: [],
    tracePreview: snapshot.events,
    openChatSessionId: snapshot.run.openChatSessionId,
    openGraphRunId: snapshot.run.openGraphRunId,
  };
}

@Injectable()
@Tool({
  name: 'run_sub_agentflow',
  description:
    'Launch a bounded child agent flow such as goal_guard_delivery_loop and return one compact summarized result.',
  parameters: {
    type: 'object',
    required: ['flowId', 'goal'],
    properties: {
      flowId: {
        type: 'string',
        description: 'Flow id to run, for example goal_guard_delivery_loop.',
      },
      goal: {
        type: 'string',
        description: 'The objective for the child AgentFlow.',
      },
      context: {
        oneOf: [{ type: 'string' }, { type: 'object' }],
        description: 'Optional extra context for the child flow.',
      },
      startMode: {
        type: 'string',
        enum: ['durable', 'blocking'],
        description: 'durable starts a long-lived supervisable flow; blocking waits for a compact result.',
      },
      vfsMode: {
        type: 'string',
        enum: ['isolated', 'shared'],
        description: 'VFS mode for the child flow. Defaults to isolated.',
      },
      copyBack: {
        type: 'boolean',
        description: 'Whether verified child artifacts should be copied back. Defaults to false.',
      },
      returnMode: {
        type: 'string',
        enum: ['summary', 'full_trace', 'artifacts_only'],
        description: 'Projection returned to the parent. Defaults to summary.',
      },
      maxSteps: {
        type: 'integer',
        description: `Maximum flow steps. Capped at ${MAX_STEPS}.`,
      },
    },
  },
  requiresConfirmation: true,
})
export class RunSubAgentFlowTool {
  private readonly logger = new Logger(RunSubAgentFlowTool.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  private getRuntime(): AgentFlowRuntimePort {
    try {
      const candidate = this.moduleRef.get(AGENT_FLOW_RUNTIME, { strict: false }) as unknown;
      if (this.isRuntime(candidate)) return candidate;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.debug(`[run_sub_agentflow] Runtime unavailable: ${error.message}`);
    }
    throw new Error('AgentFlow runtime is unavailable');
  }

  private isRuntime(value: unknown): value is AgentFlowRuntimePort {
    return typeof value === 'object'
      && value !== null
      && 'run' in value
      && typeof (value as { run?: unknown }).run === 'function';
  }

  async execute(request: ToolCallRequest): Promise<SubAgentFlowResult> {
    const parentSessionId = getParentSessionId(request);
    const args: RunSubAgentFlowArgs = {
      flowId: getRequiredString(request.args, 'flowId'),
      goal: getRequiredString(request.args, 'goal'),
      parentSessionId,
      parentToolCallId: request.callId,
      context: withLaunchAllowedToolNames(getContext(request.args), request),
      startMode: getStartMode(request.args),
      vfsMode: getVfsMode(request.args),
      copyBack: getCopyBack(request.args),
      returnMode: getReturnMode(request.args),
      maxSteps: getMaxSteps(request.args),
    };
    this.logger.log(`[run_sub_agentflow] flowId=${args.flowId} parentSessionId=${parentSessionId}`);
    const runtime = this.getRuntime();
    if (args.startMode === 'durable' && runtime.start) {
      return resultFromSnapshot(await runtime.start(args), args);
    }
    return runtime.run(args);
  }
}
