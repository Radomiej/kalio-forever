import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  ArchitectureExecutionEvent,
  ArchitectureExecutionMode,
  ArchitectureContextPolicy,
  ArchitectureRoleSlot,
  ArchitectureRun,
  ArchitectureSchema,
  ArchitectureSchemaNode,
  ToolMeta,
} from '@kalio/types';
import { ToolDispatchService } from '../chat/tool-dispatch.service';
import { SUBAGENT_RUNTIME, type SubagentEmit, type SubagentRuntimePort } from '../tool/subagent-runtime.port';
import { FINAL_ARTIFACT_CONTRACT_INSTRUCTION, parseFinalArtifactContract } from './architecture-final-artifact-contract';
import { createArchitectureBranchStreamHook, type ArchitectureBranchStreamSnapshot } from './architecture-stream-hooks';

export const ARCHITECTURE_ROLE_EXECUTOR = Symbol('ARCHITECTURE_ROLE_EXECUTOR');
const ARCHITECTURE_BRANCH_TOOL_NAMES = new Set([
  'vfs_list',
  'vfs_read',
  'vfs_grep_search',
  'vfs_file_search',
]);
const ARCHITECTURE_TOOL_EXECUTOR_TOOL_NAMES = new Set([
  ...ARCHITECTURE_BRANCH_TOOL_NAMES,
  'vfs_write',
]);
const ARCHITECTURE_PROJECT_READ_TOOL_NAMES = new Set([
  'fs_list',
  'fs_read',
]);
const ARCHITECTURE_PROJECT_WRITE_TOOL_NAMES = new Set([
  'fs_write',
]);
const ARCHITECTURE_TERMINAL_TOOL_NAMES = new Set([
  'terminal_spawn',
  'terminal_output',
  'terminal_list',
]);
const ARCHITECTURE_SUBAGENT_TOOL_NAMES = new Set([
  'run_subagent',
  'spawn_subagent',
  'message_subagent',
]);
const ARCHITECTURE_CLI_AGENT_TOOL_NAMES = new Set([
  'spawn_cli_agent',
  'message_cli_agent',
  'get_cli_agent_status',
  'wait_for',
]);

export interface ArchitectureRoleExecutionInput {
  schema: ArchitectureSchema;
  run: ArchitectureRun;
  slot: ArchitectureRoleSlot;
  branchSessionId: string;
  personaId: string;
  node?: ArchitectureSchemaNode;
  incomingEvents?: ArchitectureExecutionEvent[];
  outgoingNodeIds?: string[];
  emit?: SubagentEmit;
}

export interface ArchitectureRoleExecutionResult {
  message: string;
  data: Record<string, unknown>;
}

export interface ArchitectureToolEvidence {
  toolCallCount: number;
  toolResultCount: number;
  toolNames: string[];
  successfulToolNames: string[];
  targetPaths: string[];
  childCliSessions?: Array<{
    childSessionId: string;
    agentId?: string;
    workdir?: string;
    status?: string;
  }>;
}

type EffectiveContextPolicy = Required<Pick<
  ArchitectureContextPolicy,
  'includeUserTask'
  | 'includeProjectMemory'
  | 'includeBrowserSession'
  | 'includePriorDecisions'
>> & {
  includeOtherAgentOutputs: boolean;
  includeToolResults: boolean;
  contextCompression: NonNullable<ArchitectureContextPolicy['contextCompression']>;
};

type CliBackendPolicy = {
  preferred?: string;
  allowed: string[];
  purpose: string;
};

export interface ArchitectureRoleExecutor {
  execute(input: ArchitectureRoleExecutionInput): Promise<ArchitectureRoleExecutionResult>;
}

@Injectable()
export class ArchitectureRoleExecutorService implements ArchitectureRoleExecutor {
  constructor(
    @Optional()
    @Inject(SUBAGENT_RUNTIME)
    private readonly subagentRuntime?: SubagentRuntimePort,
    @Optional()
    private readonly toolDispatch?: ToolDispatchService,
  ) {}

  async execute(input: ArchitectureRoleExecutionInput): Promise<ArchitectureRoleExecutionResult> {
    if (input.run.executionMode === 'subagent_execution') {
      return this.executeSubagent(input);
    }
    return this.prepareBranch(input);
  }

  private prepareBranch(input: ArchitectureRoleExecutionInput): ArchitectureRoleExecutionResult {
    return {
      message: `${input.slot.label} branch prepared for: ${input.run.prompt}`,
      data: this.baseData(input, 'session_branches'),
    };
  }

  private async executeSubagent(input: ArchitectureRoleExecutionInput): Promise<ArchitectureRoleExecutionResult> {
    if (!this.subagentRuntime) {
      return {
        message: `${input.slot.label} branch prepared for: ${input.run.prompt}`,
        data: {
          ...this.baseData(input, 'subagent_execution'),
          fallbackReason: 'subagent_runtime_unavailable',
        },
      };
    }

    const streamHook = createArchitectureBranchStreamHook({
      runId: input.run.id,
      nodeId: input.node?.id,
      roleSlotId: input.slot.id,
      branchSessionId: input.branchSessionId,
      personaId: input.personaId,
      parentEmit: input.emit,
    });
    const availableTools = this.architectureBranchTools(input);
    let result: Awaited<ReturnType<SubagentRuntimePort['runSubagent']>>;
    try {
      result = await this.subagentRuntime.runSubagent({
        parentSessionId: input.run.rootSessionId ?? input.branchSessionId,
        parentToolCallId: `architecture:${input.run.id}:${input.slot.id}`,
        childSessionId: input.branchSessionId,
        personaId: input.personaId,
        objective: this.buildObjective(input),
        auditContext: {
          architectureRunId: input.run.id,
          nodeId: input.node?.id,
          roleSlotId: input.slot.id,
        },
        availableTools,
        timeoutMs: this.timeoutMsForSlot(input),
        maxIterations: this.maxIterationsForSlot(input),
        vfsMode: 'shared',
        copyOutputs: false,
        autoApproveTools: this.autoApproveToolsForSlot(input),
        emit: streamHook.emit,
      });
    } catch (error) {
      const streamSnapshot = streamHook.snapshot();
      const toolEvidence = summarizeToolEvidence(streamSnapshot);
      if (toolEvidence.toolCallCount === 0 && toolEvidence.toolResultCount === 0) {
        throw error;
      }
      const message = architectureRecoverableErrorMessage(input, error, toolEvidence);
      return {
        message,
        data: {
          ...this.baseData(input, 'subagent_execution'),
          boundedToolLoopExhausted: true,
          recoverableRuntimeError: error instanceof Error ? error.message : String(error),
          response: message,
          ...this.routeData(message, input.outgoingNodeIds ?? []),
          ...this.finalArtifactData(input, message),
          stream: compactStreamSnapshot(streamSnapshot),
          toolEvidence,
        },
      };
    }

    const streamSnapshot = streamHook.snapshot();
    const toolEvidence = summarizeToolEvidence(streamSnapshot);
    const message = architectureSlotMessage(input, result.result, toolEvidence);
    const boundedToolLoopExhausted = message !== result.result;

    return {
      message,
      data: {
        ...this.baseData(input, 'subagent_execution'),
        boundedToolLoopExhausted,
        durationMs: result.durationMs,
        response: message,
        ...this.routeData(message, input.outgoingNodeIds ?? []),
        ...this.finalArtifactData(input, message),
        rawSubagentResult: boundedToolLoopExhausted ? result.result : undefined,
        stream: compactStreamSnapshot(streamSnapshot),
        toolEvidence,
        taskId: result.taskId,
      },
    };
  }

  private timeoutMsForSlot(input: ArchitectureRoleExecutionInput): number {
    const configured = this.timeoutMsFromContext(input.run.context, input.slot.id);
    if (configured !== undefined) {
      return configured;
    }
    return input.slot.slotType === 'router' || input.slot.slotType === 'finalizer' ? 300_000 : 120_000;
  }

  private timeoutMsFromContext(context: Record<string, unknown> | undefined, slotId: string): number | undefined {
    const perSlot = context?.['maxArchitectureSubagentTimeoutMsBySlot'];
    if (perSlot && typeof perSlot === 'object' && !Array.isArray(perSlot)) {
      const value = (perSlot as Record<string, unknown>)[slotId];
      if (this.isBoundedTimeoutMs(value)) {
        return value;
      }
    }
    const value = context?.['maxArchitectureSubagentTimeoutMs'];
    return this.isBoundedTimeoutMs(value) ? value : undefined;
  }

  private isBoundedTimeoutMs(value: unknown): value is number {
    return typeof value === 'number'
      && Number.isInteger(value)
      && value >= 10_000
      && value <= 1_200_000;
  }

  private maxIterationsForSlot(input: ArchitectureRoleExecutionInput): number {
    const configured = this.maxIterationsFromContext(input.run.context, input.slot.id);
    if (configured !== undefined) {
      return configured;
    }
    return input.slot.slotType === 'tool_executor' ? 2 : 4;
  }

  private maxIterationsFromContext(context: Record<string, unknown> | undefined, slotId: string): number | undefined {
    const perSlot = context?.['maxArchitectureSubagentIterationsBySlot'];
    if (perSlot && typeof perSlot === 'object' && !Array.isArray(perSlot)) {
      const value = (perSlot as Record<string, unknown>)[slotId];
      if (this.isBoundedIterationCount(value)) {
        return value;
      }
    }
    const value = context?.['maxArchitectureSubagentIterations'];
    return this.isBoundedIterationCount(value) ? value : undefined;
  }

  private isBoundedIterationCount(value: unknown): value is number {
    return typeof value === 'number'
      && Number.isInteger(value)
      && value >= 1
      && value <= 100;
  }

  private autoApproveToolsForSlot(input: ArchitectureRoleExecutionInput): string[] | undefined {
    const canUseCliAgents = this.canUseCliAgentsForSlot(input.run.context, input.slot);
    if (input.slot.slotType === 'tool_executor') {
      const tools = ['vfs_write'];
      if (this.isImplementationWriterSlot(input.slot) && canUseCliAgents) {
        tools.push('spawn_cli_agent', 'message_cli_agent');
      }
      if (this.canAutoApproveProjectWrites(input.run.context)) {
        tools.push('fs_write');
      }
      if (this.canAutoApproveTerminal(input.run.context)) {
        tools.push('terminal_spawn');
      }
      return tools;
    }
    if (this.isOrchestrationSlot(input.slot)) {
      return canUseCliAgents
        ? ['vfs_write', 'spawn_cli_agent', 'message_cli_agent']
        : ['vfs_write'];
    }
    if (this.isGoalGuardProofImplementer(input)) {
      const tools = ['vfs_write'];
      if (this.canAutoApproveProjectWrites(input.run.context)) {
        tools.push('fs_write');
      }
      return tools;
    }
    return undefined;
  }

  private architectureBranchTools(input: ArchitectureRoleExecutionInput): ToolMeta[] {
    const allTools = this.toolDispatch?.getToolMetas() ?? [];
    if (input.slot.slotType === 'finalizer') {
      return [];
    }
    const hasLocalProjectContext = this.hasLocalProjectContext(input.run.context);
    const canUseCliAgents = this.canUseCliAgentsForSlot(input.run.context, input.slot);
    if (input.slot.slotType === 'tool_executor') {
      const gateImplementationReads = this.isImplementationWriterSlot(input.slot)
        && this.hasIncomingReadEvidence(input.incomingEvents);
      return this.withCliToolPreferences(allTools.filter((tool) => (
        (ARCHITECTURE_TOOL_EXECUTOR_TOOL_NAMES.has(tool.name) && (
          !gateImplementationReads || !ARCHITECTURE_BRANCH_TOOL_NAMES.has(tool.name)
        ))
        || (canUseCliAgents && (tool.name === 'get_cli_agent_status' || tool.name === 'wait_for'))
        || (canUseCliAgents && this.isImplementationWriterSlot(input.slot) && ARCHITECTURE_CLI_AGENT_TOOL_NAMES.has(tool.name))
        || (hasLocalProjectContext && (
          (!gateImplementationReads && ARCHITECTURE_PROJECT_READ_TOOL_NAMES.has(tool.name))
          || ARCHITECTURE_PROJECT_WRITE_TOOL_NAMES.has(tool.name)
        ))
        || (
          !gateImplementationReads
          && this.hasExecutionCwd(input.run.context)
          && ARCHITECTURE_TERMINAL_TOOL_NAMES.has(tool.name)
        )
      )), input.run.context);
    }
    if (this.isOrchestrationSlot(input.slot)) {
      return this.withCliToolPreferences(allTools.filter((tool) => (
        ARCHITECTURE_BRANCH_TOOL_NAMES.has(tool.name)
        || (this.canUseOrchestratorSubagents(input.run.context) && ARCHITECTURE_SUBAGENT_TOOL_NAMES.has(tool.name))
        || (canUseCliAgents && ARCHITECTURE_CLI_AGENT_TOOL_NAMES.has(tool.name))
        || (canUseCliAgents && tool.name === 'stop_cli_agent' && this.canUseCliStop(input.run.context))
        || (hasLocalProjectContext && ARCHITECTURE_PROJECT_READ_TOOL_NAMES.has(tool.name))
      )), input.run.context);
    }
    if (input.slot.slotType === 'judge') {
      return this.withCliToolPreferences(allTools.filter((tool) => (
        ARCHITECTURE_BRANCH_TOOL_NAMES.has(tool.name)
        || tool.name === 'run_subagent'
        || (canUseCliAgents && (tool.name === 'get_cli_agent_status' || tool.name === 'wait_for'))
        || (hasLocalProjectContext && ARCHITECTURE_PROJECT_READ_TOOL_NAMES.has(tool.name))
      )), input.run.context);
    }
    if (this.isGoalGuardProofImplementer(input)) {
      return this.withCliToolPreferences(allTools.filter((tool) => (
        ARCHITECTURE_BRANCH_TOOL_NAMES.has(tool.name)
        || tool.name === 'vfs_write'
        || (this.canAutoApproveProjectWrites(input.run.context) && tool.name === 'fs_write')
        || (hasLocalProjectContext && ARCHITECTURE_PROJECT_READ_TOOL_NAMES.has(tool.name))
      )), input.run.context);
    }
    return this.withCliToolPreferences(allTools.filter((tool) => (
      (
        ARCHITECTURE_BRANCH_TOOL_NAMES.has(tool.name)
        || (hasLocalProjectContext && ARCHITECTURE_PROJECT_READ_TOOL_NAMES.has(tool.name))
      ) && !tool.requiresConfirmation
    )), input.run.context);
  }

  private hasIncomingReadEvidence(events: ArchitectureExecutionEvent[] | undefined): boolean {
    return (events ?? []).some((event) => {
      if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
        return false;
      }
      const evidence = (event.data as Record<string, unknown>)['toolEvidence'];
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
        return false;
      }
      const successfulToolNames = (evidence as Record<string, unknown>)['successfulToolNames'];
      return Array.isArray(successfulToolNames) && successfulToolNames.some((name) => (
        name === 'vfs_read'
        || name === 'vfs_list'
        || name === 'vfs_grep_search'
        || name === 'vfs_file_search'
        || name === 'fs_read'
        || name === 'fs_list'
      ));
    });
  }

  private withCliToolPreferences(tools: ToolMeta[], context: Record<string, unknown> | undefined): ToolMeta[] {
    const preferences = this.cliAgentToolPreferences(context);
    if (!preferences) {
      return tools;
    }
    return tools.map((tool) => {
      if (!ARCHITECTURE_CLI_AGENT_TOOL_NAMES.has(tool.name) && tool.name !== 'run_cli_agent' && tool.name !== 'stop_cli_agent') {
        return tool;
      }
      return {
        ...tool,
        description: `${tool.description}\n\nArchitecture CLI preferences: ${preferences}`,
      };
    });
  }

  private cliAgentToolPreferences(context: Record<string, unknown> | undefined): string | null {
    const raw = context?.['cliAgentToolPreferences'];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }
    const lines = Object.entries(raw as Record<string, unknown>)
      .map(([agentId, value]) => this.cliAgentPreferenceLine(agentId, value))
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return lines.length > 0 ? lines.join(' | ') : null;
  }

  private cliAgentPreferenceLine(agentId: string, value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return `${agentId}: ${value.trim()}`;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const model = typeof record['model'] === 'string' && record['model'].trim().length > 0
      ? record['model'].trim()
      : null;
    const preference = typeof record['preference'] === 'string' && record['preference'].trim().length > 0
      ? record['preference'].trim()
      : null;
    if (model && preference) {
      return `${agentId} (model ${model}): ${preference}`;
    }
    if (model) {
      return `${agentId} (model ${model})`;
    }
    return preference ? `${agentId}: ${preference}` : null;
  }

  private buildObjective(input: ArchitectureRoleExecutionInput): string {
    const outgoingNodeIds = input.outgoingNodeIds ?? [];
    const policy = this.contextPolicyForSlot(input.schema.contextPolicy, input.slot.id);
    const incomingEvents = policy.includeOtherAgentOutputs ? input.incomingEvents ?? [] : [];
    const lines = [
      `Architecture: ${input.schema.name} v${input.schema.version}`,
      `Slot: ${input.slot.label} (${input.slot.slotType})`,
      input.node ? `Node: ${input.node.label} (${input.node.kind})` : null,
      policy.includeUserTask ? `Task: ${input.run.prompt}` : null,
      '',
      this.instructionForSlot(
        input.slot,
        outgoingNodeIds,
        this.canUseCliAgentsForSlot(input.run.context, input.slot),
        this.canUseOrchestratorSubagents(input.run.context),
      ),
      this.goalGuardProofImplementerInstruction(input),
      this.cliBackendPolicyInstruction(input),
    ].filter((line): line is string => typeof line === 'string');
    if (incomingEvents.length > 0) {
      lines.push('', 'Incoming graph outputs:');
      for (const event of incomingEvents) {
        lines.push(`- ${event.roleSlotId ?? event.nodeId ?? event.type}: ${event.message}${incomingEventEvidenceSummary(event)}`);
      }
    }
    if (outgoingNodeIds.length > 0) {
      lines.push('', `Available next nodes: ${outgoingNodeIds.join(', ')}`);
    }
    const canUseEvidenceTools = input.slot.slotType !== 'finalizer';
    const attachedFilePaths = canUseEvidenceTools ? this.attachedFilePaths(input.run.context) : [];
    if (attachedFilePaths.length > 0) {
      lines.push(
        '',
        'Attached VFS project files:',
        ...attachedFilePaths.map((path) => `- ${path}`),
        '',
        'If your answer depends on file content, call vfs_read or vfs_grep_search first. Do not write "I will read" unless you actually call the tool.',
      );
    }
    const localProjectPath = canUseEvidenceTools ? this.localProjectPath(input.run.context) : undefined;
    if (localProjectPath) {
      lines.push(
        '',
        `Local host project path: ${localProjectPath}`,
        'If your answer depends on host project files, call fs_list or fs_read first. Use fs_write only from tool-executor slots when an approved implementation write is required.',
      );
    }
    const context = this.contextForObjective(input.run.context, policy);
    if (Object.keys(context).length > 0) {
      lines.push('', `Context: ${JSON.stringify(context)}`);
    }
    return lines.join('\n');
  }

  private contextPolicyForSlot(policy: ArchitectureContextPolicy, slotId: string): EffectiveContextPolicy {
    const override = policy.perSlotOverrides?.[slotId] ?? {};
    return {
      includeUserTask: override.includeUserTask ?? policy.includeUserTask,
      includeProjectMemory: override.includeProjectMemory ?? policy.includeProjectMemory,
      includeBrowserSession: override.includeBrowserSession ?? policy.includeBrowserSession,
      includePriorDecisions: override.includePriorDecisions ?? policy.includePriorDecisions,
      includeOtherAgentOutputs: override.includeOtherAgentOutputs ?? policy.includeOtherAgentOutputs ?? true,
      includeToolResults: override.includeToolResults ?? policy.includeToolResults ?? false,
      contextCompression: override.contextCompression ?? policy.contextCompression ?? 'none',
    };
  }

  private contextForObjective(
    context: Record<string, unknown> | undefined,
    policy: EffectiveContextPolicy,
  ): Record<string, unknown> {
    if (!context) {
      return {};
    }
    if (policy.contextCompression === 'evidence_only') {
      return this.pickDefined({
        evidence: context['evidence'],
        citations: context['citations'],
        toolResults: policy.includeToolResults ? context['toolResults'] : undefined,
      });
    }

    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (this.isRuntimeContextKey(key) || this.isControlledContextKey(key)) {
        continue;
      }
      filtered[key] = value;
    }
    if (policy.includeProjectMemory && context['projectMemory'] !== undefined) {
      filtered['projectMemory'] = context['projectMemory'];
    }
    if (policy.includeBrowserSession && context['browserSession'] !== undefined) {
      filtered['browserSession'] = context['browserSession'];
    }
    if (policy.includePriorDecisions && context['priorDecisions'] !== undefined) {
      filtered['priorDecisions'] = context['priorDecisions'];
    }
    if (policy.includeToolResults && context['toolResults'] !== undefined) {
      filtered['toolResults'] = context['toolResults'];
    }
    return filtered;
  }

  private pickDefined(entries: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
  }

  private attachedFilePaths(context: Record<string, unknown> | undefined): string[] {
    const filePaths = context?.['hydrateFilePaths'];
    return Array.isArray(filePaths)
      ? filePaths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      : [];
  }

  private hasExecutionCwd(context: Record<string, unknown> | undefined): boolean {
    return typeof context?.['executionCwd'] === 'string' && context['executionCwd'].trim().length > 0;
  }

  private canAutoApproveProjectWrites(context: Record<string, unknown> | undefined): boolean {
    return context?.['autoApproveArchitectureProjectWrites'] === true
      && this.hasLocalProjectContext(context);
  }

  private canAutoApproveTerminal(context: Record<string, unknown> | undefined): boolean {
    return context?.['autoApproveArchitectureTerminal'] === true
      && this.hasExecutionCwd(context);
  }

  private canUseCliStop(context: Record<string, unknown> | undefined): boolean {
    return context?.['allowArchitectureCliStop'] === true;
  }

  private canUseCliAgents(context: Record<string, unknown> | undefined): boolean {
    if (context?.['architectureCliAgentsEnabled'] === false) {
      return false;
    }
    const available = context?.['availableCliAgents'];
    return !Array.isArray(available) || available.some((value) => typeof value === 'string' && value.trim().length > 0);
  }

  private canUseCliAgentsForSlot(
    context: Record<string, unknown> | undefined,
    slot: ArchitectureRoleSlot,
  ): boolean {
    if (!this.canUseCliAgents(context)) {
      return false;
    }
    return !this.isOrchestrationSlot(slot) || this.canUseOrchestratorSubagents(context);
  }

  private canUseOrchestratorSubagents(context: Record<string, unknown> | undefined): boolean {
    return context?.['allowArchitectureOrchestratorSubagents'] === true;
  }

  private hasLocalProjectContext(context: Record<string, unknown> | undefined): boolean {
    return this.localProjectPath(context) !== undefined;
  }

  private localProjectPath(context: Record<string, unknown> | undefined): string | undefined {
    const projectPath = context?.['projectPath'];
    if (typeof projectPath === 'string' && projectPath.trim().length > 0) {
      return projectPath.trim();
    }
    const executionCwd = context?.['executionCwd'];
    if (typeof executionCwd === 'string' && executionCwd.trim().length > 0) {
      return executionCwd.trim();
    }
    return undefined;
  }

  private isRuntimeContextKey(key: string): boolean {
    return key === 'parentSessionId'
      || key === 'maxArchitectureSteps'
      || key === 'maxArchitectureNodeVisits'
      || key === 'maxArchitectureSubagentIterations'
      || key === 'maxArchitectureSubagentIterationsBySlot'
      || key === 'maxArchitectureSubagentTimeoutMs'
      || key === 'maxArchitectureSubagentTimeoutMsBySlot'
      || key === 'cliBackendPolicy'
      || key === 'cliAgentToolPreferences'
      || key === 'architectureCliAgentsEnabled'
      || key === 'allowArchitectureOrchestratorSubagents'
      || key === 'availableCliAgents'
      || key === 'autoApproveArchitectureProjectWrites'
      || key === 'autoApproveArchitectureTerminal'
      || key === 'allowArchitectureCliStop'
      || key === 'requireGoalMasterLoopProof'
      || key === 'requireImplementerWriteProof'
      || key === 'hydrateFromSessionId'
      || key === 'hydrateTargetPrefix'
      || key === 'hydrateFilePaths';
  }

  private cliBackendPolicyInstruction(input: ArchitectureRoleExecutionInput): string | null {
    if (!this.canUseCliAgentsForSlot(input.run.context, input.slot)) {
      return 'CLI agents are unavailable for this run. Do not call CLI-agent tools or claim CLI implementation proof; use Kalio sub-agents and visible VFS/tool evidence instead.';
    }
    const policy = this.cliBackendPolicyForSlot(input.run.context, input.slot);
    if (!policy) {
      return null;
    }
    const preferred = policy.preferred ? ` Preferred CLI backend: ${policy.preferred}.` : '';
    return [
      'CLI backend policy:',
      `${policy.purpose}.`,
      `${preferred} Allowed CLI backends: ${policy.allowed.join(', ')}.`,
      'When calling spawn_cli_agent, message_cli_agent, or run_cli_agent, set agentId explicitly from this policy; do not rely on the default Copilot adapter unless Copilot is the selected backend.',
      'If the selected CLI backend is unavailable or fails, record that evidence, choose the next allowed backend when appropriate, or continue with Kalio sub-agents instead of silently changing the architecture role.',
    ].join(' ');
  }

  private cliBackendPolicyForSlot(
    context: Record<string, unknown> | undefined,
    slot: ArchitectureRoleSlot,
  ): CliBackendPolicy | null {
    const configured = this.configuredCliBackendPolicyForSlot(context, slot.id);
    if (configured) {
      return configured;
    }
    if (this.isOrchestrationSlot(slot)) {
      return {
        allowed: ['gemini', 'copilot', 'codex'],
        purpose: 'Use Gemini for reconnaissance or brainstorming, Copilot for implementation delegation, and Codex for conservative analysis or final verification delegation',
      };
    }
    if (slot.id === 'implementer') {
      return {
        preferred: 'codex',
        allowed: ['codex', 'copilot'],
        purpose: 'Use Codex for implementation work; use Copilot only as an explicit fallback when Codex is unavailable or the run config selects Copilot',
      };
    }
    if (slot.id === 'verifier' || slot.id === 'tester') {
      return {
        preferred: 'codex',
        allowed: ['codex', 'gemini'],
        purpose: 'Use Codex for conservative verification; use Gemini only for broad analysis when Codex is unavailable',
      };
    }
    if (slot.slotType === 'judge') {
      return {
        preferred: 'codex',
        allowed: ['codex', 'gemini'],
        purpose: 'Use Codex for strict completion review and Gemini only for secondary brainstorming about unresolved weak points',
      };
    }
    return null;
  }

  private configuredCliBackendPolicyForSlot(
    context: Record<string, unknown> | undefined,
    slotId: string,
  ): CliBackendPolicy | null {
    const raw = context?.['cliBackendPolicy'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }
    const slotPolicy = (raw as Record<string, unknown>)[slotId] ?? (raw as Record<string, unknown>)['default'];
    if (!slotPolicy || typeof slotPolicy !== 'object' || Array.isArray(slotPolicy)) {
      return null;
    }
    const record = slotPolicy as Record<string, unknown>;
    const allowed = Array.isArray(record['allowed'])
      ? record['allowed'].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    if (allowed.length === 0) {
      return null;
    }
    const preferred = typeof record['preferred'] === 'string' && record['preferred'].trim().length > 0
      ? record['preferred'].trim()
      : undefined;
    const purpose = typeof record['purpose'] === 'string' && record['purpose'].trim().length > 0
      ? record['purpose'].trim()
      : 'Use the configured CLI backend policy for this architecture slot';
    return { preferred, allowed, purpose };
  }

  private isControlledContextKey(key: string): boolean {
    return key === 'projectMemory'
      || key === 'browserSession'
      || key === 'priorDecisions'
      || key === 'toolResults'
      || key === 'evidence'
      || key === 'citations';
  }

  private instructionForSlot(
    slot: ArchitectureRoleSlot,
    outgoingNodeIds: string[],
    canUseCliAgents = true,
    canUseOrchestratorSubagents = false,
  ): string {
    if (slot.slotType === 'judge') {
      const routeHint = outgoingNodeIds.length > 0
        ? `Available next nodes are ${outgoingNodeIds.join(', ')}. If acceptance evidence is incomplete, route to the continuation node with route_to(<nodeId>, reason). Route to the final artifact only when incoming graph outputs prove the goal is complete.`
        : 'Explain whether the incoming graph outputs prove the goal is complete.';
      return [
        'Act as a strict Goal Master judge.',
        'Use only the incoming graph outputs and provided evidence. Do not invent previous passes, hidden work, files, tests, or approvals.',
        'You may delegate focused review checks with synchronous run_subagent and inspect CLI child-session status, but do not spawn background review agents from this judge slot. Final acceptance must cite visible evidence from incoming outputs or tool results.',
        'If you mention a previous rejection, loop, pass, test, or artifact, it must be visible in the incoming graph outputs.',
        routeHint,
        'Also include a fenced JSON routerOutput object with selectedStrategy, mergedDecision, acceptedInputs, rejectedInputs, unresolvedConflicts, risks, confidence, and nextAction.',
      ].join(' ');
    }
    if (slot.slotType === 'router') {
      const contract = 'Also include a fenced JSON routerOutput object with selectedStrategy, mergedDecision, acceptedInputs, rejectedInputs, unresolvedConflicts, risks, confidence, and nextAction.';
      if (this.isOrchestrationSlot(slot)) {
        const llmSubagentRule = canUseOrchestratorSubagents
          ? 'LLM sub-agents may be used only for focused checks when a graph node is not the right execution target.'
          : 'LLM sub-agent tools are disabled for this orchestrator slot.';
        const agentMap = canUseCliAgents
          ? `Treat CLI agents as delegated sub-agents at the architecture level: Copilot CLI is the implementation sub-agent backend, Codex CLI is the conservative development or code-analysis sub-agent backend, and Gemini CLI is the broad analysis or brainstorming sub-agent backend. Use spawn_cli_agent only when the architecture policy exposes it and a durable external child is explicitly required; otherwise route to the next graph node. ${llmSubagentRule}`
          : canUseOrchestratorSubagents
            ? 'CLI agents are not available in this run. Use Kalio sub-agent tools only for focused checks when a graph node is not the right execution target.'
            : 'CLI agents and LLM sub-agent tools are unavailable for this orchestrator slot; route to the next architecture node instead.';
        const routingRule = canUseOrchestratorSubagents
          ? 'When the next graph node is known, prefer route_to(targetNodeId, response) over spawning another child.'
          : 'This run keeps orchestration inside the architecture graph: do not call run_subagent, spawn_subagent, or message_subagent from the orchestrator. Choose the next architecture node with route_to(targetNodeId, response) and let that node execute the work.';
        return outgoingNodeIds.length > 0
          ? `Act as the delivery orchestrator. Define acceptance criteria, decompose the goal into concrete steps, then route graph execution. ${agentMap} ${routingRule} Route to the next implementation node with route_to(targetNodeId, response) once the next step is clear. Do not claim files, tests, or completion unless visible tool output proves them. ${contract}`
          : `Act as the delivery orchestrator. Define acceptance criteria, decompose the goal into concrete steps, then route graph execution. ${agentMap} ${routingRule} Do not claim files, tests, or completion unless visible tool output proves them. ${contract}`;
      }
      return outgoingNodeIds.length > 0
        ? `Act as a graph router. Synthesize only the incoming outputs. Do not claim files, tools, or capabilities unless incoming outputs explicitly prove them. When choosing a specific next node, include one line exactly like route_to(targetNodeId, response). ${contract}`
        : `Act as a graph router. Synthesize only the incoming outputs and explain the routing decision. Do not claim files, tools, or capabilities unless incoming outputs explicitly prove them. ${contract}`;
    }
    if (slot.slotType === 'finalizer') {
      return [
        'Produce the final user-facing answer from the incoming graph outputs.',
        'Do not call tools or start a new investigation. Do not describe runtime mechanics unless they are relevant to the answer. Do not claim files, tools, or capabilities unless incoming outputs explicitly prove them.',
        FINAL_ARTIFACT_CONTRACT_INSTRUCTION,
      ].join(' ');
    }
    if (slot.slotType === 'tool_executor') {
      return [
        'Act as an execution slot, not a planner.',
        'Use the available tools to implement or verify the incoming architecture step.',
        'If this slot is an implementer, create or update the required artifacts first with vfs_write, fs_write, or a durable CLI child agent. An implementer cannot pass by only inspecting an existing artifact or running build/test commands; build-only work belongs to verifier slots. Do not spend early tool calls on environment probes such as node -v, npm -v, or git branch unless the incoming evidence says those probes are required before writing.',
        'If this implementer delegates writes to a CLI child, use spawn_cli_agent with expectedChangedFiles and verificationCommands when possible, then poll get_cli_agent_status and report the childSessionId, status, changed paths, and weak points. Do not spawn a second implementation path when an existing CLI child already owns the same work; poll or message that child instead.',
        'After an implementer has visible write evidence, it may run install/build commands when terminal tools are available, then report exact paths written and command results.',
        'If this slot is a verifier, use VFS or host-project reads as evidence unless terminal tools are available with an explicit execution cwd in context; when incoming evidence references a CLI child session, inspect it with get_cli_agent_status before judging the delegated work.',
        'When terminal tools are available, run the narrowest relevant command and report exact command, exit status, and tool output summary.',
        'If a required write or command needs human approval, request it through the tool flow and stop after reporting the pending approval.',
        'Do not claim runtime proof unless a visible tool result proves it.',
      ].join(' ');
    }
    return [
      'Return a concise role-specific contribution for the next graph node.',
      'If project files are attached or a local project path is available, gather only the smallest evidence batch you need with read/list tools, then stop calling tools and answer.',
      'After any successful file read/list result, produce a final answer with exactly: Recommendation, Evidence, Risk, Next step.',
      'Do not spend the full tool budget exploring; prefer a partial evidence-based conclusion over another read when the next useful action is already clear.',
    ].join(' ');
  }

  private goalGuardProofImplementerInstruction(input: ArchitectureRoleExecutionInput): string | null {
    if (!this.isGoalGuardProofImplementer(input)) {
      return null;
    }
    const projectWriteInstruction = this.canAutoApproveProjectWrites(input.run.context)
      ? ' When a local project path is configured, use fs_write for host project files.'
      : '';
    return `Implementation proof mode: the Implementer must create or update at least one artifact with vfs_write before completing.${projectWriteInstruction} A read-only recommendation is incomplete evidence for Goal Guard.`;
  }

  private isGoalGuardProofImplementer(input: ArchitectureRoleExecutionInput): boolean {
    return input.slot.id === 'implementer'
      && (
        input.run.context?.['requireGoalMasterLoopProof'] === true
        || input.run.context?.['requireImplementerWriteProof'] === true
      );
  }

  private routeData(message: string, outgoingNodeIds: string[]): Record<string, unknown> {
    const parsedRoute = parseRouteToCall(message);
    if (!parsedRoute || !outgoingNodeIds.includes(parsedRoute.targetNodeId)) {
      return {};
    }
    return {
      route_to: {
        targetNodeId: parsedRoute.targetNodeId,
        response: parsedRoute.response && parsedRoute.response.length > 0 ? parsedRoute.response : message,
      },
    };
  }

  private finalArtifactData(input: ArchitectureRoleExecutionInput, message: string): Record<string, unknown> {
    if (input.slot.slotType !== 'finalizer') {
      return {};
    }
    const parsed = parseFinalArtifactContract(message);
    if (!parsed) {
      return {};
    }
    return {
      finalArtifactStatus: parsed.status,
      acceptanceStatus: parsed.status,
      ...(parsed.blockingReason ? { blockingReason: parsed.blockingReason } : {}),
      ...(parsed.evidence.length > 0 ? { evidence: parsed.evidence } : {}),
    };
  }

  private isOrchestrationSlot(slot: ArchitectureRoleSlot): boolean {
    return slot.slotType === 'router' && /\borchestrator\b/i.test(`${slot.id} ${slot.label}`);
  }

  private isImplementationWriterSlot(slot: ArchitectureRoleSlot): boolean {
    return slot.id === 'implementer';
  }

  private baseData(
    input: ArchitectureRoleExecutionInput,
    executionMode: ArchitectureExecutionMode,
  ): Record<string, unknown> {
    return {
      branchSessionId: input.branchSessionId,
      personaId: input.personaId,
      sessionPersonaId: input.personaId,
      rootSessionId: input.run.rootSessionId,
      slotType: input.slot.slotType,
      executionMode,
    };
  }
}

function parseRouteToCall(message: string): { targetNodeId: string; response?: string } | null {
  const marker = 'route_to(';
  const start = message.toLowerCase().indexOf(marker);
  if (start < 0) {
    return null;
  }

  const bodyStart = start + marker.length;
  let depth = 1;
  let bodyEnd = -1;
  for (let index = bodyStart; index < message.length; index += 1) {
    const char = message[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        bodyEnd = index;
        break;
      }
    }
  }
  if (bodyEnd < 0) {
    return null;
  }

  const body = message.slice(bodyStart, bodyEnd);
  const commaIndex = body.indexOf(',');
  const rawTarget = commaIndex >= 0 ? body.slice(0, commaIndex) : body;
  const targetNodeId = normalizedRouteTarget(rawTarget);
  if (!/^[A-Za-z0-9_.:-]+$/.test(targetNodeId)) {
    return null;
  }
  const response = commaIndex >= 0 ? body.slice(commaIndex + 1).trim() : undefined;
  return { targetNodeId, response };
}

function normalizedRouteTarget(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  const namedTarget = trimmed.match(/^(?:targetNodeId|nodeId)\s*=\s*['"]?([^'"]+)['"]?$/i);
  return (namedTarget?.[1] ?? trimmed).trim();
}

function architectureSlotMessage(
  input: ArchitectureRoleExecutionInput,
  rawMessage: string,
  toolEvidence: ArchitectureToolEvidence,
): string {
  if (
    !isExhaustedSubagentResult(rawMessage)
    || input.slot.slotType === 'tool_executor'
    || toolEvidence.toolResultCount === 0
  ) {
    return rawMessage;
  }

  const successful = toolEvidence.successfulToolNames.length > 0
    ? toolEvidence.successfulToolNames.join(', ')
    : 'none';
  const evidencePaths = compactEvidencePaths(input, toolEvidence.targetPaths);
  const paths = evidencePaths.length > 0
    ? `Evidence paths: ${evidencePaths.slice(0, 8).join(', ')}.`
    : '';
  const nextNode = input.outgoingNodeIds?.[0];
  const route = input.slot.slotType === 'router' && nextNode
    ? `\nroute_to(${nextNode}, bounded evidence pass completed; synthesize from collected tool evidence)`
    : '';

  if (input.slot.slotType === 'router') {
    return [
      `${input.slot.label} completed a bounded evidence pass.`,
      `Evidence: ${toolEvidence.toolResultCount} tool result(s), successful=${successful}.`,
      paths,
      'Risk: the router did not produce a full narrative before the tool budget ended.',
      'Next step: synthesize from collected evidence and continue to the selected node.',
      route,
    ].filter((part) => part.length > 0).join(' ');
  }

  return [
    `${input.slot.label} completed a bounded evidence pass.`,
    `Recommendation: ${boundedRecommendationForSlot(input.slot)}.`,
    `Evidence: ${toolEvidence.toolResultCount} tool result(s), successful=${successful}.`,
    paths,
    'Risk: the slot did not produce a full narrative before the tool budget ended.',
    'Next step: pass this evidence to the router/finalizer; rerun this slot with a larger iteration budget only if its independent reasoning is required.',
  ].filter((part) => part.length > 0).join(' ');
}

function boundedRecommendationForSlot(slot: ArchitectureRoleSlot): string {
  const text = `${slot.id} ${slot.label} ${slot.description}`.toLowerCase();
  if (text.includes('advocate') || text.includes('user')) {
    return 'prioritize the user-visible improvement with the clearest evidence and lowest onboarding friction';
  }
  if (text.includes('critic') || text.includes('devil') || text.includes('shadow')) {
    return 'prefer the option with the smallest regression surface and explicit fallback behavior';
  }
  if (text.includes('innovator')) {
    return 'choose the improvement that makes the demo feel more intentional without touching core runtime logic';
  }
  if (text.includes('analyst') || text.includes('data') || text.includes('cost')) {
    return 'choose the improvement supported by the most direct file evidence and easiest verification path';
  }
  return 'choose the lowest-risk improvement supported by the collected project evidence';
}

function architectureRecoverableErrorMessage(
  input: ArchitectureRoleExecutionInput,
  error: unknown,
  toolEvidence: ArchitectureToolEvidence,
): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const successful = toolEvidence.successfulToolNames.length > 0
    ? toolEvidence.successfulToolNames.join(', ')
    : 'none';
  const evidencePaths = compactEvidencePaths(input, toolEvidence.targetPaths);
  const paths = evidencePaths.length > 0
    ? `Evidence paths: ${evidencePaths.slice(0, 8).join(', ')}.`
    : '';
  const nextNode = input.outgoingNodeIds?.[0];
  const route = input.slot.slotType === 'router' && nextNode
    ? `\nroute_to(${nextNode}, recoverable branch error after partial tool evidence; inspect worktree and continue)`
    : '';

  return [
    `${input.slot.label} hit a recoverable branch error: ${errorMessage}.`,
    `Partial tool evidence: ${toolEvidence.toolResultCount} result(s), ${toolEvidence.toolCallCount} call(s), successful=${successful}.`,
    paths,
    'Conclusion: continue the architecture with explicit verification of the visible worktree instead of discarding the child-agent work.',
    route,
  ].filter((part) => part.length > 0).join(' ');
}

function compactEvidencePaths(input: ArchitectureRoleExecutionInput, paths: string[]): string[] {
  const root = localProjectPathFromContext(input.run.context);
  if (!root) {
    return paths;
  }
  const normalizedRoot = trimTrailingSlash(root).toLowerCase();
  return paths.map((path) => {
    const normalizedPath = path.toLowerCase();
    if (normalizedPath === normalizedRoot) {
      return '.';
    }
    const prefix = `${normalizedRoot}\\`;
    if (normalizedPath.startsWith(prefix)) {
      return path.slice(prefix.length).replace(/\\/g, '/');
    }
    return path.replace(/\\/g, '/');
  });
}

function localProjectPathFromContext(context: Record<string, unknown> | undefined): string | undefined {
  const projectPath = context?.['projectPath'];
  if (typeof projectPath === 'string' && projectPath.trim().length > 0) {
    return projectPath.trim();
  }
  const executionCwd = context?.['executionCwd'];
  if (typeof executionCwd === 'string' && executionCwd.trim().length > 0) {
    return executionCwd.trim();
  }
  return undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function isExhaustedSubagentResult(message: string): boolean {
  return message.includes('without producing a final answer');
}

function compactStreamSnapshot(snapshot: ArchitectureBranchStreamSnapshot): Record<string, unknown> {
  return {
    streamGroupId: snapshot.streamGroupId,
    runId: snapshot.runId,
    nodeId: snapshot.nodeId,
    roleSlotId: snapshot.roleSlotId,
    branchSessionId: snapshot.branchSessionId,
    personaId: snapshot.personaId,
    status: snapshot.status,
    chunkCount: snapshot.chunkCount,
    toolCallCount: snapshot.events.filter((event) => event.event === 'tool:start').length,
    toolResultCount: snapshot.events.filter((event) => event.event === 'tool:result').length,
  };
}

function summarizeToolEvidence(snapshot: ArchitectureBranchStreamSnapshot): ArchitectureToolEvidence {
  const toolNames = uniqueStrings(snapshot.events
    .filter((event) => event.event === 'tool:start' && event.toolName)
    .map((event) => event.toolName));
  const successfulToolNames = uniqueStrings(snapshot.events
    .filter((event) => event.event === 'tool:result' && event.toolName && isSuccessfulToolResultEvent(event))
    .map((event) => event.toolName));
  const targetPaths = uniqueStrings(snapshot.events
    .filter((event) => event.event === 'tool:start' && event.toolPath)
    .map((event) => event.toolPath));
  const childCliSessions = summarizeChildCliSessions(snapshot);
  return {
    toolCallCount: snapshot.events.filter((event) => event.event === 'tool:start').length,
    toolResultCount: snapshot.events.filter((event) => event.event === 'tool:result').length,
    toolNames,
    successfulToolNames,
    targetPaths,
    ...(childCliSessions.length > 0 ? { childCliSessions } : {}),
  };
}

function isSuccessfulToolResultEvent(event: ArchitectureBranchStreamSnapshot['events'][number]): boolean {
  if (event.status === 'success') {
    return true;
  }
  return event.status !== 'failed' && event.status !== 'error';
}

function summarizeChildCliSessions(
  snapshot: ArchitectureBranchStreamSnapshot,
): NonNullable<ArchitectureToolEvidence['childCliSessions']> {
  const sessions = new Map<string, NonNullable<ArchitectureToolEvidence['childCliSessions']>[number]>();
  for (const event of snapshot.events) {
    if (!event.childSessionId || !isCliAgentStreamToolName(event.toolName)) {
      continue;
    }
    if (
      event.toolName === 'get_cli_agent_status'
      && !event.childStatus
      && !event.agentId
      && !event.workdir
    ) {
      continue;
    }
    const previous = sessions.get(event.childSessionId) ?? { childSessionId: event.childSessionId };
    sessions.set(event.childSessionId, {
      ...previous,
      agentId: event.agentId ?? previous.agentId,
      workdir: event.workdir ?? event.toolPath ?? previous.workdir,
      status: event.status ?? previous.status,
      ...(event.childStatus ? { status: event.childStatus } : {}),
    });
  }
  return [...sessions.values()];
}

function isCliAgentStreamToolName(toolName: string | undefined): boolean {
  return toolName === 'run_cli_agent'
    || toolName === 'spawn_cli_agent'
    || toolName === 'message_cli_agent'
    || toolName === 'get_cli_agent_status'
    || toolName === 'stop_cli_agent';
}

function incomingEventEvidenceSummary(event: ArchitectureExecutionEvent): string {
  const data = isRecord(event.data) ? event.data : {};
  const eventRecord: Record<string, unknown> = isRecord(event) ? event : {};
  const parts: string[] = [];
  const incompleteReason = typeof data['incompleteReason'] === 'string'
    ? data['incompleteReason']
    : typeof eventRecord['incompleteReason'] === 'string'
      ? eventRecord['incompleteReason']
      : undefined;
  const toolEvidence = isToolEvidence(data['toolEvidence']) ? data['toolEvidence'] : undefined;

  if (toolEvidence) {
    const successful = toolEvidence.successfulToolNames.length > 0
      ? toolEvidence.successfulToolNames.join(', ')
      : 'none';
    const targetPathList = Array.isArray(toolEvidence.targetPaths) ? toolEvidence.targetPaths : [];
    const targetPaths = targetPathList.length > 0
      ? `, paths=${targetPathList.slice(0, 6).join(', ')}`
      : '';
    const childCliSessions = Array.isArray(toolEvidence.childCliSessions)
      ? toolEvidence.childCliSessions.filter((item): item is NonNullable<ArchitectureToolEvidence['childCliSessions']>[number] => isRecord(item) && typeof item['childSessionId'] === 'string')
      : [];
    const childCliSummary = childCliSessions.length > 0
      ? `, childCliSessions=${childCliSessions
        .slice(0, 3)
        .map((session) => `${session.childSessionId}${session.status ? `:${session.status}` : ''}${session.workdir ? `@${session.workdir}` : ''}`)
        .join(', ')}`
      : '';
    parts.push(`toolEvidence=${toolEvidence.toolResultCount} result(s), successful=${successful}${targetPaths}${childCliSummary}`);
  }
  if (incompleteReason) {
    parts.push(`incomplete=${incompleteReason}`);
  }

  return parts.length > 0 ? ` [${parts.join('; ')}]` : '';
}

function isToolEvidence(value: unknown): value is ArchitectureToolEvidence {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value['toolCallCount'] === 'number'
    && typeof value['toolResultCount'] === 'number'
    && Array.isArray(value['toolNames'])
    && Array.isArray(value['successfulToolNames'])
    && value['toolNames'].every((item) => typeof item === 'string')
    && value['successfulToolNames'].every((item) => typeof item === 'string')
    && (
      value['targetPaths'] === undefined
      || (Array.isArray(value['targetPaths']) && value['targetPaths'].every((item) => typeof item === 'string'))
    )
    && (
      value['childCliSessions'] === undefined
      || (Array.isArray(value['childCliSessions']) && value['childCliSessions'].every((item) => (
        isRecord(item)
        && typeof item['childSessionId'] === 'string'
        && (item['agentId'] === undefined || typeof item['agentId'] === 'string')
        && (item['workdir'] === undefined || typeof item['workdir'] === 'string')
        && (item['status'] === undefined || typeof item['status'] === 'string')
      )))
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}
