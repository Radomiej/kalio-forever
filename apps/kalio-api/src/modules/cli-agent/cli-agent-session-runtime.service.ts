import { Injectable } from '@nestjs/common';
import type {
  CLIAgentResult,
  CLIAgentSessionSnapshot,
  CLIAgentSessionStatus,
  ChatMessage,
  ToolCallRequest,
  ToolResult,
} from '@kalio/types';
import { nanoid } from 'nanoid';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';
import { CLIAgentService, type CLIAgentRunResult } from './cli-agent.service';
import { CLIAgentConfigService } from './cli-agent-config.service';
import { CLIAgentSessionService } from './cli-agent-session.service';
import {
  appendAcceptanceInstructions,
  appendWorktreeStatus,
  type CLIAgentAcceptanceHints,
  getWorktreeStatusSummary,
  hasMissingAcceptanceEvidence,
} from './cli-agent-worktree-summary';
import { createWorkflowError, isWorkflowError } from '../../common/utils/workflow-error.util';

const SESSION_OUTPUT_LIMIT = 6_000;
const HISTORY_MESSAGE_LIMIT = 8;
const MAX_AUTO_RECOVERY_ATTEMPTS = 3;
const CLI_AGENT_SESSION_STATUSES = new Set<CLIAgentSessionStatus>([
  'idle',
  'running',
  'completed',
  'failed',
  'stopped',
]);

interface SpawnSessionParams {
  parentSessionId: string;
  parentToolCallId: string;
  prompt: string;
  workdir: string;
  agentId: string;
  timeoutMs?: number;
  acceptanceHints?: CLIAgentAcceptanceHints;
  emit?: ToolCallRequest['_emit'];
}

interface ContinueSessionParams {
  parentSessionId: string;
  childSessionId: string;
  prompt: string;
  interruptRunning?: boolean;
  timeoutMs?: number;
  acceptanceHints?: CLIAgentAcceptanceHints;
  emit?: ToolCallRequest['_emit'];
}

interface RuntimeEntry {
  snapshot: CLIAgentSessionSnapshot;
  completion: Promise<CLIAgentSessionSnapshot>;
  callId: string;
  turnId: string;
  emit?: ToolCallRequest['_emit'];
  terminalEmitted: boolean;
}

@Injectable()
export class CLIAgentSessionRuntimeService {
  private readonly runtimeEntries = new Map<string, RuntimeEntry>();

  constructor(
    private readonly cliAgent: CLIAgentService,
    private readonly sessions: CLIAgentSessionService,
    private readonly allowedPaths: AllowedPathsService,
    private readonly config: CLIAgentConfigService,
  ) {}

  async spawnSession(params: SpawnSessionParams): Promise<CLIAgentSessionSnapshot> {
    await this.assertAllowedWorkdir(params.workdir);

    const childSession = await this.sessions.createChildSession({
      parentSessionId: params.parentSessionId,
      parentToolCallId: params.parentToolCallId,
      agentId: params.agentId,
      title: `${params.agentId} CLI: ${params.prompt.slice(0, 48)}${params.prompt.length > 48 ? '...' : ''}`,
    });

    await this.sessions.saveSessionMetadata(childSession.id, {
      agentId: params.agentId,
      workdir: params.workdir,
    });

    params.emit?.('session:created', childSession);

    return this.startSessionTurn({
      parentSessionId: params.parentSessionId,
      childSessionId: childSession.id,
      prompt: params.prompt,
      workdir: params.workdir,
      agentId: params.agentId,
      timeoutMs: params.timeoutMs,
      acceptanceHints: params.acceptanceHints,
      emit: params.emit,
      history: [],
      recoveryAttempts: 0,
    });
  }

  async continueSession(params: ContinueSessionParams): Promise<CLIAgentSessionSnapshot> {
    const childSession = await this.sessions.getAccessibleChildSession(params.parentSessionId, params.childSessionId);
    if (!childSession || childSession.kind !== 'cli-agent') {
      throw new Error(`CLI_AGENT_SESSION_NOT_FOUND: ${params.childSessionId}`);
    }

    const metadata = await this.sessions.loadSessionMetadata(childSession.id);
    if (!metadata) {
      throw createWorkflowError('CLI_AGENT_SESSION_METADATA_MISSING', `CLI metadata missing for child session ${childSession.id}.`, {
        source: 'cli-agent-session-runtime',
        retryable: false,
      });
    }

    await this.assertAllowedWorkdir(metadata.workdir);

    if (this.cliAgent.isRunning(childSession.id)) {
      if (!params.interruptRunning) {
        throw new Error(`CLI_AGENT_BUSY: ${childSession.id}`);
      }
      await this.stopSession(params.parentSessionId, childSession.id, params.emit);
    }

    const history = await this.sessions.listMessages(childSession.id);

    return this.startSessionTurn({
      parentSessionId: params.parentSessionId,
      childSessionId: childSession.id,
      prompt: params.prompt,
      workdir: metadata.workdir,
      agentId: metadata.agentId,
      timeoutMs: params.timeoutMs,
      acceptanceHints: params.acceptanceHints,
      emit: params.emit,
      history,
      recoveryAttempts: 0,
    });
  }

  async getStatus(parentSessionId: string, childSessionId: string): Promise<CLIAgentSessionSnapshot> {
    const childSession = await this.sessions.getAccessibleChildSession(parentSessionId, childSessionId);
    if (!childSession || childSession.kind !== 'cli-agent') {
      throw new Error(`CLI_AGENT_SESSION_NOT_FOUND: ${childSessionId}`);
    }

    const liveEntry = this.runtimeEntries.get(childSessionId);
    if (liveEntry) {
      return liveEntry.snapshot;
    }

    const metadata = await this.sessions.loadSessionMetadata(childSessionId);
    if (!metadata) {
      throw createWorkflowError('CLI_AGENT_SESSION_METADATA_MISSING', `CLI metadata missing for child session ${childSessionId}.`, {
        source: 'cli-agent-session-runtime',
        retryable: false,
      });
    }

    const history = await this.sessions.listMessages(childSessionId);
    const lastPrompt = [...history].reverse().find((message) => message.role === 'user')?.content ?? '';
    const lastToolResult = await this.sessions.loadLatestToolResult(childSessionId);
    const persisted = this.parsePersistedSnapshot(lastToolResult?.content ?? null);

    return {
      childSessionId,
      parentSessionId,
      agentId: persisted?.agentId ?? metadata.agentId,
      workdir: persisted?.workdir ?? metadata.workdir,
      status: persisted?.status ?? 'idle',
      lastPrompt,
      updatedAt: persisted?.updatedAt ?? childSession.updatedAt,
      startedAt: persisted?.startedAt,
      completedAt: persisted?.completedAt,
      activeCallId: persisted?.activeCallId,
      lastOutput: persisted?.lastOutput,
      lastExitCode: persisted?.lastExitCode,
      recoveryAttempts: persisted?.recoveryAttempts,
    };
  }

  async stopSession(
    parentSessionId: string,
    childSessionId: string,
    emit?: ToolCallRequest['_emit'],
  ): Promise<CLIAgentSessionSnapshot> {
    const childSession = await this.sessions.getAccessibleChildSession(parentSessionId, childSessionId);
    if (!childSession || childSession.kind !== 'cli-agent') {
      throw new Error(`CLI_AGENT_SESSION_NOT_FOUND: ${childSessionId}`);
    }

    const liveEntry = this.runtimeEntries.get(childSessionId);
    if (!liveEntry) {
      return this.getStatus(parentSessionId, childSessionId);
    }

    const activeEmit = emit ?? liveEntry.emit;
    if (activeEmit && activeEmit !== liveEntry.emit) {
      this.runtimeEntries.set(childSessionId, {
        ...liveEntry,
        emit: activeEmit,
      });
    }
    const stopped = this.cliAgent.stop(childSessionId);
    if (stopped) {
      try {
        return await liveEntry.completion;
      } catch {
        const settled = this.runtimeEntries.get(childSessionId);
        return settled?.snapshot ?? liveEntry.snapshot;
      }
    }

    return liveEntry.snapshot;
  }

  private async startSessionTurn(params: {
    parentSessionId: string;
    childSessionId: string;
    prompt: string;
    workdir: string;
    agentId: string;
    timeoutMs?: number;
    acceptanceHints?: CLIAgentAcceptanceHints;
    emit?: ToolCallRequest['_emit'];
    history: ChatMessage[];
    recoveryAttempts: number;
  }): Promise<CLIAgentSessionSnapshot> {
    const callId = `cli-run-${nanoid()}`;
    const turnId = `cli-turn-${callId}`;
    const promptForAgent = appendAcceptanceInstructions(params.prompt, params.acceptanceHints);
    const effectivePrompt = this.buildPromptFromHistory(params.history, promptForAgent, params.workdir);

    await this.sessions.persistUserMessage(params.childSessionId, params.prompt);
    await this.sessions.persistAssistantToolCallMessage(params.childSessionId, callId, {
      agentId: params.agentId,
      workdir: params.workdir,
      prompt: params.prompt,
      ...(params.acceptanceHints ? { acceptanceHints: params.acceptanceHints } : {}),
    });

    const runningSnapshot: CLIAgentSessionSnapshot = {
      childSessionId: params.childSessionId,
      parentSessionId: params.parentSessionId,
      agentId: params.agentId,
      workdir: params.workdir,
      status: 'running',
      lastPrompt: params.prompt,
      updatedAt: Date.now(),
      startedAt: Date.now(),
      activeCallId: callId,
      lastOutput: '',
      recoveryAttempts: params.recoveryAttempts,
    };

    const completion = this.executeSessionTurn({
      snapshot: runningSnapshot,
      effectivePrompt,
      timeoutMs: params.timeoutMs,
      acceptanceHints: params.acceptanceHints,
      emit: params.emit,
      turnId,
      callId,
      recoveryAttempts: params.recoveryAttempts,
    });

    this.runtimeEntries.set(params.childSessionId, {
      snapshot: runningSnapshot,
      completion,
      callId,
      turnId,
      emit: params.emit,
      terminalEmitted: false,
    });

    return runningSnapshot;
  }

  private async executeSessionTurn(params: {
    snapshot: CLIAgentSessionSnapshot;
    effectivePrompt: string;
    timeoutMs?: number;
    acceptanceHints?: CLIAgentAcceptanceHints;
    emit?: ToolCallRequest['_emit'];
    turnId: string;
    callId: string;
    recoveryAttempts: number;
  }): Promise<CLIAgentSessionSnapshot> {
    params.emit?.('agent:start', {
      sessionId: params.snapshot.childSessionId,
      turnId: params.turnId,
    });
    params.emit?.('tool:start', {
      callId: params.callId,
      toolName: 'run_cli_agent',
      args: {
        agentId: params.snapshot.agentId,
        workdir: params.snapshot.workdir,
        prompt: params.snapshot.lastPrompt,
      },
      sessionId: params.snapshot.childSessionId,
    });

    try {
      const result = await this.cliAgent.run({
        agentId: params.snapshot.agentId,
        prompt: params.effectivePrompt,
        workdir: params.snapshot.workdir,
        callId: params.callId,
        sessionId: params.snapshot.childSessionId,
        turnId: params.turnId,
        timeoutMs: params.timeoutMs,
        emitFn: params.emit
          ? (event, data) => {
              this.updateRuntimeOutput(params.snapshot.childSessionId, data.chunk);
              params.emit?.(event, data);
            }
          : undefined,
      });

      return this.finalizeSuccess(
        params.snapshot.childSessionId,
        params.callId,
        params.turnId,
        params.emit,
        result,
        params.acceptanceHints,
      );
    } catch (err: unknown) {
      const recoveryPrompt = await this.autoRecoveryPrompt(params.snapshot.agentId, err, params.recoveryAttempts);
      if (!recoveryPrompt) {
        return this.finalizeFailure(params.snapshot.childSessionId, params.callId, params.turnId, params.emit, err);
      }

      await this.persistRecoverableIdleTimeout(params.snapshot.childSessionId, params.callId, err);

      params.emit?.('cli_agent:progress', {
        callId: params.callId,
        sessionId: params.snapshot.childSessionId,
        turnId: params.turnId,
        agentId: params.snapshot.agentId,
        chunk: `\n[Kalio auto-recovery] ${recoveryPrompt}\n`,
      });

      const history = await this.sessions.listMessages(params.snapshot.childSessionId);
      return this.startSessionTurn({
        parentSessionId: params.snapshot.parentSessionId,
        childSessionId: params.snapshot.childSessionId,
        prompt: recoveryPrompt,
        workdir: params.snapshot.workdir,
        agentId: params.snapshot.agentId,
        timeoutMs: params.timeoutMs,
        acceptanceHints: params.acceptanceHints,
        emit: params.emit,
        history,
        recoveryAttempts: params.recoveryAttempts + 1,
      });
    }
  }

  private async finalizeSuccess(
    childSessionId: string,
    callId: string,
    turnId: string,
    emit: ToolCallRequest['_emit'] | undefined,
    result: CLIAgentRunResult,
    acceptanceHints: CLIAgentAcceptanceHints | undefined,
  ): Promise<CLIAgentSessionSnapshot> {
    const current = this.runtimeEntries.get(childSessionId)?.snapshot;
    const worktreeStatus = await getWorktreeStatusSummary(current?.workdir ?? '', acceptanceHints);
    const outputWithStatus = appendWorktreeStatus(result.output, worktreeStatus);
    const accepted = result.outcome === 'completed'
      && result.exitCode === 0
      && !hasMissingAcceptanceEvidence(worktreeStatus);
    const persistedExitCode = accepted ? result.exitCode : 1;
    const persistedResult: CLIAgentResult & {
      rawExitCode?: number;
      failureCode?: string;
      toolResultStatus?: 'success' | 'error';
      toolResultErrorCode?: string;
      toolResultErrorMessage?: string;
    } = {
      output: outputWithStatus,
      exitCode: persistedExitCode,
      durationMs: result.durationMs,
      agentId: result.agentId,
      childSessionId,
      rawExitCode: result.rawExitCode,
      ...(result.failureCode ? { failureCode: result.failureCode } : {}),
      toolResultStatus: accepted ? 'success' : 'error',
      ...(result.failureCode === 'auth_required'
        ? {
            toolResultErrorCode: 'CLI_AGENT_AUTH_REQUIRED',
            toolResultErrorMessage: outputWithStatus,
          }
        : {}),
    };
    const completedSnapshot: CLIAgentSessionSnapshot = {
      childSessionId,
      parentSessionId: current?.parentSessionId ?? '',
      agentId: result.agentId,
      workdir: current?.workdir ?? '',
      status: accepted ? 'completed' : 'failed',
      lastPrompt: current?.lastPrompt ?? '',
      updatedAt: Date.now(),
      startedAt: current?.startedAt,
      completedAt: Date.now(),
      lastOutput: outputWithStatus,
      lastExitCode: persistedExitCode,
      recoveryAttempts: current?.recoveryAttempts,
    };

    await this.sessions.saveToolResult(
      childSessionId,
      callId,
      JSON.stringify({
        ...completedSnapshot,
        ...persistedResult,
      }),
    );
    await this.sessions.persistAssistantMessage(
      childSessionId,
      outputWithStatus.trim().length > 0
        ? outputWithStatus
        : `CLI agent completed with exit code ${persistedExitCode}.`,
    );

    const toolResult: ToolResult = accepted
      ? {
          callId,
          toolName: 'run_cli_agent',
          sessionId: childSessionId,
          status: 'success',
          data: persistedResult,
        }
      : {
          callId,
          toolName: 'run_cli_agent',
          sessionId: childSessionId,
          status: 'error',
          ...(result.failureCode === 'auth_required'
            ? {
                errorCode: 'CLI_AGENT_AUTH_REQUIRED',
                errorMessage: outputWithStatus,
              }
            : {}),
          data: persistedResult,
        };

    this.emitTerminalEvents(emit, childSessionId, turnId, toolResult);
    this.setSettledRuntimeEntry(childSessionId, completedSnapshot, callId, turnId, emit, true);

    return completedSnapshot;
  }

  private async finalizeFailure(
    childSessionId: string,
    callId: string,
    turnId: string,
    emit: ToolCallRequest['_emit'] | undefined,
    err: unknown,
  ): Promise<CLIAgentSessionSnapshot> {
    const current = this.runtimeEntries.get(childSessionId)?.snapshot;
    const error = err instanceof Error ? err : new Error(String(err));
    if (isWorkflowError(error, 'CLI_AGENT_STOPPED')) {
      const activeEmit = this.runtimeEntries.get(childSessionId)?.emit ?? emit;
      return this.finalizeStopped(childSessionId, callId, turnId, activeEmit);
    }

    const nextSnapshot: CLIAgentSessionSnapshot = {
      childSessionId,
      parentSessionId: current?.parentSessionId ?? '',
      agentId: current?.agentId ?? 'copilot',
      workdir: current?.workdir ?? '',
      status: 'failed',
      lastPrompt: current?.lastPrompt ?? '',
      updatedAt: Date.now(),
      startedAt: current?.startedAt,
      completedAt: Date.now(),
      lastOutput: error.message,
      lastExitCode: 1,
      recoveryAttempts: current?.recoveryAttempts,
    };

    await this.sessions.saveToolResult(
      childSessionId,
      callId,
      JSON.stringify({
        ...nextSnapshot,
        toolResultStatus: 'error',
        toolResultErrorCode: 'CLI_AGENT_ERROR',
        toolResultErrorMessage: error.message,
      }),
    );
    await this.sessions.persistAssistantMessage(childSessionId, nextSnapshot.lastOutput ?? '');

    this.emitTerminalEvents(emit, childSessionId, turnId, {
      callId,
      toolName: 'run_cli_agent',
      sessionId: childSessionId,
      status: 'error',
      errorCode: 'CLI_AGENT_ERROR',
      errorMessage: error.message,
      data: nextSnapshot,
    });
    this.setSettledRuntimeEntry(childSessionId, nextSnapshot, callId, turnId, emit, true);

    return nextSnapshot;
  }

  private async finalizeStopped(
    childSessionId: string,
    callId: string,
    turnId: string,
    emit: ToolCallRequest['_emit'] | undefined,
  ): Promise<CLIAgentSessionSnapshot> {
    const current = this.runtimeEntries.get(childSessionId);
    if (current?.terminalEmitted) {
      return current.snapshot;
    }

    const nextSnapshot: CLIAgentSessionSnapshot = {
      childSessionId,
      parentSessionId: current?.snapshot.parentSessionId ?? '',
      agentId: current?.snapshot.agentId ?? 'copilot',
      workdir: current?.snapshot.workdir ?? '',
      status: 'stopped',
      lastPrompt: current?.snapshot.lastPrompt ?? '',
      updatedAt: Date.now(),
      startedAt: current?.snapshot.startedAt,
      completedAt: Date.now(),
      lastOutput: current?.snapshot.lastOutput ?? 'CLI agent stopped.',
      lastExitCode: 130,
      recoveryAttempts: current?.snapshot.recoveryAttempts,
    };

    await this.sessions.saveToolResult(
      childSessionId,
      callId,
      JSON.stringify({
        ...nextSnapshot,
        toolResultStatus: 'cancelled',
      }),
    );
    await this.sessions.persistAssistantMessage(childSessionId, nextSnapshot.lastOutput ?? '');

    this.emitTerminalEvents(emit, childSessionId, turnId, {
      callId,
      toolName: 'run_cli_agent',
      sessionId: childSessionId,
      status: 'cancelled',
      data: nextSnapshot,
    });
    this.setSettledRuntimeEntry(childSessionId, nextSnapshot, callId, turnId, emit ?? current?.emit, true);

    return nextSnapshot;
  }

  private emitTerminalEvents(
    emit: ToolCallRequest['_emit'] | undefined,
    childSessionId: string,
    turnId: string,
    toolResult: ToolResult,
  ): void {
    emit?.('tool:result', toolResult);
    emit?.('agent:done', { sessionId: childSessionId, turnId });
  }

  private setSettledRuntimeEntry(
    childSessionId: string,
    snapshot: CLIAgentSessionSnapshot,
    callId: string,
    turnId: string,
    emit: ToolCallRequest['_emit'] | undefined,
    terminalEmitted: boolean,
  ): void {
    this.runtimeEntries.set(childSessionId, {
      snapshot,
      completion: Promise.resolve(snapshot),
      callId,
      turnId,
      emit,
      terminalEmitted,
    });
  }

  private updateRuntimeOutput(childSessionId: string, chunk: string): void {
    const runtime = this.runtimeEntries.get(childSessionId);
    if (!runtime) {
      return;
    }

    runtime.snapshot = {
      ...runtime.snapshot,
      updatedAt: Date.now(),
      lastOutput: this.tailText(`${runtime.snapshot.lastOutput ?? ''}${chunk}`),
    };
    this.runtimeEntries.set(childSessionId, runtime);
  }

  private parsePersistedSnapshot(content: string | null): CLIAgentSessionSnapshot | null {
    if (!content) {
      return null;
    }

    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (
        typeof parsed['childSessionId'] !== 'string' ||
        typeof parsed['parentSessionId'] !== 'string' ||
        typeof parsed['agentId'] !== 'string' ||
        typeof parsed['workdir'] !== 'string' ||
        !isCliAgentSessionStatus(parsed['status']) ||
        typeof parsed['lastPrompt'] !== 'string' ||
        typeof parsed['updatedAt'] !== 'number'
      ) {
        return null;
      }

      return {
        childSessionId: parsed['childSessionId'],
        parentSessionId: parsed['parentSessionId'],
        agentId: parsed['agentId'],
        workdir: parsed['workdir'],
        status: parsed['status'],
        lastPrompt: parsed['lastPrompt'],
        updatedAt: parsed['updatedAt'],
        startedAt: typeof parsed['startedAt'] === 'number' ? parsed['startedAt'] : undefined,
        completedAt: typeof parsed['completedAt'] === 'number' ? parsed['completedAt'] : undefined,
        activeCallId: typeof parsed['activeCallId'] === 'string' ? parsed['activeCallId'] : undefined,
        lastOutput: typeof parsed['lastOutput'] === 'string' ? parsed['lastOutput'] : typeof parsed['output'] === 'string' ? parsed['output'] : undefined,
        lastExitCode: typeof parsed['lastExitCode'] === 'number' ? parsed['lastExitCode'] : typeof parsed['exitCode'] === 'number' ? parsed['exitCode'] : undefined,
        recoveryAttempts: typeof parsed['recoveryAttempts'] === 'number' ? parsed['recoveryAttempts'] : undefined,
      };
    } catch {
      return null;
    }
  }

  private buildPromptFromHistory(history: ChatMessage[], nextPrompt: string, workdir: string): string {
    const workdirContext = [
      `Working directory: ${workdir}`,
      'Treat this directory as the default scope for file reads, searches, edits, and commands unless the instruction explicitly narrows it.',
    ].join('\n');
    const visibleHistory = history
      .filter((message) => message.role !== 'system')
      .slice(-HISTORY_MESSAGE_LIMIT)
      .map((message) => this.formatHistoryMessage(message))
      .filter((message): message is string => message !== null);

    if (visibleHistory.length === 0) {
      return [workdirContext, nextPrompt].join('\n\n');
    }

    return [
      'You are continuing an existing Kalio CLI child session. The repository state may already reflect earlier work.',
      workdirContext,
      'Recent session history:',
      ...visibleHistory,
      `New instruction: ${nextPrompt}`,
    ].join('\n\n');
  }

  private formatHistoryMessage(message: ChatMessage): string | null {
    if (message.role === 'user') {
      return `User: ${message.content}`;
    }

    if (message.role === 'assistant') {
      if (!message.toolCalls || message.toolCalls.length === 0) {
        return message.content.trim().length > 0 ? `Assistant: ${message.content}` : null;
      }
      return `Assistant invoked ${message.toolCalls.map((toolCall) => toolCall.name).join(', ')}.`;
    }

    if (message.role === 'tool_result') {
      return `CLI result: ${this.summarizeToolResult(message.content)}`;
    }

    return null;
  }

  private summarizeToolResult(content: string): string {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (typeof parsed['lastOutput'] === 'string') {
        return this.tailText(parsed['lastOutput']);
      }
      if (typeof parsed['output'] === 'string') {
        return this.tailText(parsed['output']);
      }
    } catch {
      return this.tailText(content);
    }

    return this.tailText(content);
  }

  private tailText(value: string): string {
    return value.length <= SESSION_OUTPUT_LIMIT ? value : value.slice(-SESSION_OUTPUT_LIMIT);
  }

  private async persistRecoverableIdleTimeout(childSessionId: string, callId: string, err: unknown): Promise<void> {
    const current = this.runtimeEntries.get(childSessionId)?.snapshot;
    const error = err instanceof Error ? err : new Error(String(err));
    const recoveringSnapshot: CLIAgentSessionSnapshot = {
      childSessionId,
      parentSessionId: current?.parentSessionId ?? '',
      agentId: current?.agentId ?? 'copilot',
      workdir: current?.workdir ?? '',
      status: 'running',
      lastPrompt: current?.lastPrompt ?? '',
      updatedAt: Date.now(),
      startedAt: current?.startedAt,
      activeCallId: callId,
      lastOutput: this.tailText(`${current?.lastOutput ?? ''}\n[Kalio auto-recovery] ${error.message}`),
      recoveryAttempts: current?.recoveryAttempts,
    };

    await this.sessions.saveToolResult(
      childSessionId,
      callId,
      JSON.stringify({
        ...recoveringSnapshot,
        recoverableIdleTimeout: true,
        errorMessage: error.message,
      }),
    );

    const existing = this.runtimeEntries.get(childSessionId);
    this.runtimeEntries.set(childSessionId, {
      snapshot: recoveringSnapshot,
      completion: existing?.completion ?? Promise.resolve(recoveringSnapshot),
      callId: existing?.callId ?? callId,
      turnId: existing?.turnId ?? `cli-turn-${callId}`,
      emit: existing?.emit,
      terminalEmitted: existing?.terminalEmitted ?? false,
    });
  }

  private async autoRecoveryPrompt(agentId: string, err: unknown, recoveryAttempts: number): Promise<string | null> {
    if (!isIdleTimeoutError(err) || recoveryAttempts >= MAX_AUTO_RECOVERY_ATTEMPTS) {
      return null;
    }

    const config = await this.config.getConfig(agentId);
    if (!config.autoRecoveryEnabled) {
      return null;
    }

    const prompt = config.autoRecoveryPrompt ?? 'continue';
    return prompt.trim().length > 0 ? prompt.trim() : 'continue';
  }

  private async assertAllowedWorkdir(workdir: string): Promise<void> {
    const allowed = await this.allowedPaths.isAllowed(workdir);
    if (!allowed) {
      throw new Error(`ACCESS_DENIED: workdir is not in AllowedPaths: ${workdir}. Add it via Settings > Allowed Paths first.`);
    }
  }
}

function isCliAgentSessionStatus(value: unknown): value is CLIAgentSessionStatus {
  return typeof value === 'string' && CLI_AGENT_SESSION_STATUSES.has(value as CLIAgentSessionStatus);
}

function isIdleTimeoutError(err: unknown): boolean {
  return isWorkflowError(err, 'TIMEOUT')
    && typeof (err as { source?: unknown }).source === 'string'
    && (err as { source: string }).source === 'cli-agent-idle-timeout';
}
