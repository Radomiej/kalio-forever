import { ArchitectureRoleObjective } from './architecture-role-objective';
import { buildGoalProposalWorkerContract, validateGoalProposalWorkerOutput } from './architecture-goal-worker-contract';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  ArchitectureExecutionEvent,
  ArchitectureExecutionMode,
  ArchitectureGoalPacketV1,
  ArchitectureRouterOutput,
  ArchitectureRoleSlot,
  ArchitectureRun,
  ArchitectureSchema,
  ArchitectureSchemaNode,
  HostRuntimeReceiptObserver,
} from '@kalio/types';
import { buildArchitectureSlotToolPolicy } from '../chat/architecture-slot-tool-policy';
import { SUBAGENT_RUNTIME, type SubagentEmit, type SubagentRuntimePort } from '../tool/subagent-runtime.port';
import {
  finalArtifactContractFromStructuredOutput,
  routerOutputFromStructuredOutput,
  structuredRouteToCall,
} from './architecture-structured-output';
import { structuredOutputForArchitectureSlot } from './architecture-structured-output-contracts';
import { createArchitectureBranchStreamHook } from './architecture-stream-hooks';
import { architectureRoleMaxIterations, architectureRoleTimeoutMs } from './architecture-role-execution-budget.utils';
import {
  architectureRecoverableErrorMessage,
  architectureSlotMessage,
  compactStreamSnapshot,
  summarizeToolEvidence,
} from './architecture-role-evidence.utils';
import { PersonaService } from '../persona/persona.service';
import { CredentialsService } from '../credentials/credentials.service';
import { createWorkflowError, workflowFailureFromError } from '../../common/utils/workflow-error.util';

export const ARCHITECTURE_ROLE_EXECUTOR = Symbol('ARCHITECTURE_ROLE_EXECUTOR');

export interface ArchitectureRoleExecutionInput {
  schema: ArchitectureSchema;
  run: ArchitectureRun;
  slot: ArchitectureRoleSlot;
  branchSessionId: string;
  personaId: string;
  node?: ArchitectureSchemaNode;
  incomingEvents?: ArchitectureExecutionEvent[];
  outgoingNodeIds?: string[];
  resumeChildTurnId?: string;
  emit?: SubagentEmit;
  /** Host-supplied only, never read from run.context or model tool arguments. */
  purpose?: { kind: 'goal_proposal'; packet: ArchitectureGoalPacketV1 };
  /** Host-only object capability; never derive from run context or DTOs. */
  hostRuntimeReceiptObserver?: HostRuntimeReceiptObserver;
}

export interface ArchitectureRoleExecutionResult {
  message: string;
  data: Record<string, unknown>;
  structuredOutput?: unknown;
}

export interface ArchitectureRoleExecutor {
  execute(input: ArchitectureRoleExecutionInput): Promise<ArchitectureRoleExecutionResult>;
}

@Injectable()
export class ArchitectureRoleExecutorService implements ArchitectureRoleExecutor {
  private readonly executionPolicy = new ArchitectureRoleObjective();
  constructor(
    @Optional()
    @Inject(SUBAGENT_RUNTIME)
    private readonly subagentRuntime?: SubagentRuntimePort,
    @Optional() private readonly personaService?: PersonaService,
    @Optional() private readonly credentialsService?: CredentialsService,
  ) {}

  async execute(input: ArchitectureRoleExecutionInput): Promise<ArchitectureRoleExecutionResult> {
    if (input.hostRuntimeReceiptObserver && (input.run.executionMode !== 'subagent_execution' || !this.subagentRuntime)) {
      throw createWorkflowError('CONTRACT_VIOLATION', 'Host receipt execution requires the subagent runtime.', { source: 'architecture-role-executor' });
    }
    if (input.purpose && (input.purpose.kind !== 'goal_proposal' || input.run.executionMode !== 'subagent_execution' || !this.subagentRuntime)) {
      throw createWorkflowError('CONTRACT_VIOLATION', 'Goal proposal requires the subagent runtime.', { source: 'architecture-goal-worker' });
    }
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

    let goalSnapshot: ArchitectureGoalPacketV1 | undefined;
    let goalContract: ReturnType<typeof buildGoalProposalWorkerContract> | undefined;
    try {
      if (input.purpose) {
        goalSnapshot = structuredClone(input.purpose.packet);
        goalContract = buildGoalProposalWorkerContract(goalSnapshot, buildArchitectureSlotToolPolicy({
          slot: input.slot, node: input.node, architectureContext: input.run.context, incomingEvents: input.incomingEvents,
        }));
      }
    } catch {
      throw createWorkflowError('CONTRACT_VIOLATION', 'Invalid goal proposal worker contract.', { source: 'architecture-goal-worker' });
    }
    const goalStillCurrent = () => {
      try { return input.purpose?.kind === 'goal_proposal' && JSON.stringify(input.purpose.packet) === JSON.stringify(goalSnapshot); }
      catch { return false; }
    };
    const streamHook = createArchitectureBranchStreamHook({
      runId: input.run.id,
      nodeId: input.node?.id,
      roleSlotId: input.slot.id,
      branchSessionId: input.branchSessionId,
      personaId: input.personaId,
      parentEmit: input.emit,
    });
    const slotPolicy = goalContract?.slotPolicy ?? buildArchitectureSlotToolPolicy({
      slot: input.slot,
      node: input.node,
      architectureContext: input.run.context,
      incomingEvents: input.incomingEvents,
    });
    let result: Awaited<ReturnType<SubagentRuntimePort['runSubagent']>>;
    try {
      const maxIterations = await this.maxIterationsForSlot(input);
      if (goalContract && !goalStillCurrent()) throw new Error('Stale goal worker contract.');
      result = await this.subagentRuntime.runSubagent({
        parentSessionId: input.run.rootSessionId ?? input.branchSessionId,
        parentToolCallId: `architecture:${input.run.id}:${input.slot.id}`,
        childSessionId: input.branchSessionId,
        resumeTurnId: input.resumeChildTurnId,
        personaId: input.personaId,
        model: input.hostRuntimeReceiptObserver ? undefined : this.modelForSlot(input),
        hostRuntimeReceiptObserver: input.hostRuntimeReceiptObserver,
        objective: goalContract?.objective ?? this.executionPolicy.buildObjective(input),
        auditContext: {
          architectureRunId: input.run.id,
          schemaId: input.schema.id,
          schemaName: input.schema.name,
          nodeId: input.node?.id,
          roleSlotId: input.slot.id,
          roleSlotType: input.slot.slotType,
          roleLabel: input.slot.label,
          displayLabel: input.slot.label,
          ...(goalSnapshot ? { purpose: 'goal_proposal', goalSourceVersion: goalSnapshot.version, goalSourceFingerprint: goalSnapshot.sourceFingerprint } : {}),
        },
        slotPolicy: slotPolicy ?? undefined,
        architectureContext: input.run.context,
        timeoutMs: this.timeoutMsForSlot(input),
        maxIterations,
        structuredOutput: goalContract?.structuredOutput ?? structuredOutputForArchitectureSlot(input.slot),
        vfsMode: 'shared',
        copyOutputs: false,
        autoApproveTools: goalContract ? [] : this.executionPolicy.autoApproveToolsForSlot(input),
        emit: streamHook.emit,
      });
    } catch (error) {
      if (input.hostRuntimeReceiptObserver) throw error;
      if (goalContract) throw createWorkflowError('CONTRACT_VIOLATION', 'Goal proposal worker failed.', { source: 'architecture-goal-worker' });
      const streamSnapshot = streamHook.snapshot();
      const toolEvidence = summarizeToolEvidence(streamSnapshot);
      if (toolEvidence.toolCallCount === 0 && toolEvidence.toolResultCount === 0) {
        throw error;
      }
      const failure = workflowFailureFromError(error);
      const message = architectureRecoverableErrorMessage(input, error, toolEvidence);
      return {
        message,
        data: {
          ...this.baseData(input, 'subagent_execution'),
          boundedToolLoopExhausted: true,
          errorCode: failure.code,
          failure,
          recoverableRuntimeError: failure.message,
          response: message,
          ...this.recoverableRouteData(input, 'recoverable branch error after partial tool evidence; inspect worktree and continue'),
          ...this.finalArtifactData(input, undefined),
          stream: compactStreamSnapshot(streamSnapshot),
          toolEvidence,
        },
      };
    }

    const streamSnapshot = streamHook.snapshot();
    const toolEvidence = summarizeToolEvidence(streamSnapshot);
    if (goalSnapshot && goalContract) {
      try {
        if (!goalStillCurrent() || result.status !== 'completed' || result.reasonCode || result.errorCode || result.failure) {
          throw new Error('Invalid goal proposal completion.');
        }
        const structuredOutput = validateGoalProposalWorkerOutput(goalSnapshot, result.structuredOutput);
        return { message: 'Goal proposal returned for host review.', structuredOutput, data: {
          ...this.baseData(input, 'subagent_execution'), taskId: result.taskId, durationMs: result.durationMs,
          goalSourceVersion: goalSnapshot.version, goalSourceFingerprint: goalSnapshot.sourceFingerprint,
          stream: compactStreamSnapshot(streamSnapshot), toolEvidence,
        } };
      } catch {
        throw createWorkflowError('CONTRACT_VIOLATION', 'Invalid or stale goal proposal worker output.', { source: 'architecture-goal-worker' });
      }
    }
    const boundedToolLoopExhausted = result.reasonCode === 'max_steps';
    const message = architectureSlotMessage(input, result.result, toolEvidence, boundedToolLoopExhausted, result.structuredOutput);

    return {
      message,
      data: {
        ...this.baseData(input, 'subagent_execution'),
        boundedToolLoopExhausted,
        reasonCode: result.reasonCode,
        errorCode: result.errorCode,
        failure: result.failure,
        durationMs: result.durationMs,
        response: message,
        ...this.routeData(message, result.structuredOutput, input.outgoingNodeIds ?? [], input, boundedToolLoopExhausted),
        ...this.finalArtifactData(input, result.structuredOutput),
        rawSubagentResult: boundedToolLoopExhausted ? result.result : undefined,
        stream: compactStreamSnapshot(streamSnapshot),
        toolEvidence,
        taskId: result.taskId,
      },
    };
  }

  private timeoutMsForSlot(input: ArchitectureRoleExecutionInput): number {
    return architectureRoleTimeoutMs({
      slotId: input.slot.id,
      context: input.run.context,
    });
  }

  private modelForSlot(input: ArchitectureRoleExecutionInput): string | undefined {
    const perSlot = input.run.context?.['architectureModelBySlot'];
    if (perSlot && typeof perSlot === 'object' && !Array.isArray(perSlot)) {
      const value = (perSlot as Record<string, unknown>)[input.slot.id];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    const preferenceKey = this.executionPolicy.isHighLevelSlot(input.slot)
      ? 'highLevelModelPreference'
      : 'workerModelPreference';
    const preference = input.run.context?.[preferenceKey];
    return typeof preference === 'string' && preference.trim().length > 0
      ? preference.trim()
      : undefined;
  }

  private async maxIterationsForSlot(input: ArchitectureRoleExecutionInput): Promise<number> {
    const personaOverride = await this.personaService?.getSessionConfig(input.personaId).then((config) => config?.maxToolAttempts ?? null);
    const global = await this.credentialsService?.getMaxToolAttempts();
    return architectureRoleMaxIterations({
      slotId: input.slot.id,
      context: input.run.context,
      nodeMaxToolAttempts: input.node?.maxToolAttempts,
      personaMaxToolAttempts: personaOverride,
      globalMaxToolAttempts: global,
    });
  }

  private routeData(
    message: string,
    structuredOutput: unknown,
    outgoingNodeIds: string[],
    input: ArchitectureRoleExecutionInput,
    boundedToolLoopExhausted: boolean,
  ): Record<string, unknown> {
    const typedRouterOutput = routerOutputFromStructuredOutput(structuredOutput);
    const parsedRoute = structuredRouteToCall(structuredOutput);
    if (structuredOutput !== undefined && input.node?.kind === 'router') {
      if (!typedRouterOutput) {
        throw createWorkflowError(
          'CONTRACT_VIOLATION',
          `${input.slot.label} structured router output did not match the workflow contract.`,
          { source: 'architecture-router', retryable: false },
        );
      }
      if (
        typedRouterOutput.nextAction === 'route_to'
        && (!parsedRoute || !outgoingNodeIds.includes(parsedRoute.targetNodeId))
      ) {
        throw createWorkflowError(
          'CONTRACT_VIOLATION',
          `${input.slot.label} structured router output selected an invalid workflow target.`,
          { source: 'architecture-router', retryable: false },
        );
      }
    }
    if (parsedRoute && outgoingNodeIds.includes(parsedRoute.targetNodeId)) {
      return {
        routerOutput: parsedRoute.routerOutput,
        route_to: {
          targetNodeId: parsedRoute.targetNodeId,
          response: parsedRoute.response && parsedRoute.response.length > 0 ? parsedRoute.response : message,
        },
      };
    }
    if (typedRouterOutput && typedRouterOutput.nextAction !== 'route_to') {
      return { routerOutput: typedRouterOutput };
    }
    return boundedToolLoopExhausted
      ? this.recoverableRouteData(input, 'bounded evidence pass completed; synthesize from collected tool evidence')
      : {};
  }

  private recoverableRouteData(input: ArchitectureRoleExecutionInput, response: string): Record<string, unknown> {
    const nextNode = input.slot.slotType === 'router' ? input.outgoingNodeIds?.[0] : undefined;
    if (!nextNode) {
      return {};
    }
    const routerOutput: ArchitectureRouterOutput = {
      selectedStrategy: nextNode,
      mergedDecision: response,
      acceptedInputs: [],
      rejectedInputs: [],
      unresolvedConflicts: [],
      risks: [],
      confidence: 0.45,
      nextAction: 'route_to',
      targetNodeId: nextNode,
      response,
    };
    return {
      routerOutput,
      route_to: {
        targetNodeId: nextNode,
        response,
      },
    };
  }

  private finalArtifactData(
    input: ArchitectureRoleExecutionInput,
    structuredOutput: unknown,
  ): Record<string, unknown> {
    if (input.slot.slotType !== 'finalizer') {
      return {};
    }
    const parsed = finalArtifactContractFromStructuredOutput(structuredOutput);
    if (!parsed) {
      return {};
    }
    return {
      finalArtifactStatus: parsed.status,
      acceptanceStatus: parsed.status,
      ...(parsed.blockingReason ? { blockingReason: parsed.blockingReason } : {}),
      ...(parsed.evidence.length > 0 ? { evidence: parsed.evidence } : {}),
      ...(parsed.answer ? { finalArtifactAnswer: parsed.answer } : {}),
    };
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
