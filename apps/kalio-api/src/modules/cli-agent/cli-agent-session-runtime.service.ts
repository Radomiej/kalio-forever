import { Injectable } from '@nestjs/common';
import type { CLIAgentResult, CLIAgentSessionSnapshot, ChatMessage, ToolCallRequest, ToolResult } from '@kalio/types';
import { nanoid } from 'nanoid';
import { CLIAgentService, CLI_AGENT_STOPPED_ERROR } from './cli-agent.service';
import { CLIAgentSessionService } from './cli-agent-session.service';

const SESSION_OUTPUT_LIMIT = 6_000;
const HISTORY_MESSAGE_LIMIT = 8;

interface SpawnSessionParams {
  parentSessionId: string;
  parentToolCallId: string;
  prompt: string;
  workdir: string;
  agentId: string;
  timeoutMs?: number;
  emit?: ToolCallRequest['_emit'];
}

interface ContinueSessionParams {
  parentSessionId: string;
  childSessionId: string;
  prompt: string;
  interruptRunning?: boolean;
  timeoutMs?: number;
  emit?: ToolCallRequest['_emit'];
}

interface RuntimeEntry {
  snapshot: CLIAgentSessionSnapshot;
  completion: Promise<CLIAgentSessionSnapshot>;
}

@Injectable()
export class CLIAgentSessionRuntimeService {
  private readonly runtimeEntries = new Map<string, RuntimeEntry>();

  constructor(
    private readonly cliAgent: CLIAgentService,
    private readonly sessions: CLIAgentSessionService,
  ) {}

  async spawnSession(params: SpawnSessionParams): Promise<CLIAgentSessionSnapshot> {
    const childSession = await this.sessions.createChildSession({
      parentSessionId: params.parentSessionId,
      parentToolCallId: params.parentToolCallId,
      agentId: params.agentId,
      title: `${params.agentId} CLI: ${params.prompt.slice(0, 48)}${params.prompt.length > 48 ? '…' : ''}`,
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
      emit: params.emit,
      history: [],
    });
  }

  async continueSession(params: ContinueSessionParams): Promise<CLIAgentSessionSnapshot> {
    const childSession = await this.sessions.getChildSession(params.parentSessionId, params.childSessionId);
    if (!childSession || childSession.kind !== 'cli-agent') {
      throw new Error(`CLI_AGENT_SESSION_NOT_FOUND: ${params.childSessionId}`);
    }

    const metadata = await this.sessions.loadSessionMetadata(childSession.id);
    if (!metadata) {
      throw new Error(`CLI_AGENT_SESSION_METADATA_MISSING: ${childSession.id}`);
    }

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
      emit: params.emit,
      history,
    });
  }

  async getStatus(parentSessionId: string, childSessionId: string): Promise<CLIAgentSessionSnapshot> {
    const childSession = await this.sessions.getChildSession(parentSessionId, childSessionId);
    if (!childSession || childSession.kind !== 'cli-agent') {
      throw new Error(`CLI_AGENT_SESSION_NOT_FOUND: ${childSessionId}`);
    }

    const liveEntry = this.runtimeEntries.get(childSessionId);
    if (liveEntry) {
      return liveEntry.snapshot;
    }

    const metadata = await this.sessions.loadSessionMetadata(childSessionId);
    if (!metadata) {
      throw new Error(`CLI_AGENT_SESSION_METADATA_MISSING: ${childSessionId}`);
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
    };
  }

  async stopSession(
    parentSessionId: string,
    childSessionId: string,
    _emit?: ToolCallRequest['_emit'],
  ): Promise<CLIAgentSessionSnapshot> {
    const childSession = await this.sessions.getChildSession(parentSessionId, childSessionId);
    if (!childSession || childSession.kind !== 'cli-agent') {
      throw new Error(`CLI_AGENT_SESSION_NOT_FOUND: ${childSessionId}`);
    }

    const liveEntry = this.runtimeEntries.get(childSessionId);
    if (!liveEntry) {
      return this.getStatus(parentSessionId, childSessionId);
    }

    const stopped = this.cliAgent.stop(childSessionId);
    if (!stopped) {
      return liveEntry.snapshot;
    }

    return liveEntry.completion;
  }

  private async startSessionTurn(params: {
    parentSessionId: string;
    childSessionId: string;
    prompt: string;
    workdir: string;
    agentId: string;
    timeoutMs?: number;
    emit?: ToolCallRequest['_emit'];
    history: ChatMessage[];
  }): Promise<CLIAgentSessionSnapshot> {
    const callId = `cli-run-${nanoid()}`;
    const turnId = `cli-turn-${callId}`;
    const effectivePrompt = this.buildPromptFromHistory(params.history, params.prompt);

    await this.sessions.persistUserMessage(params.childSessionId, params.prompt);
    await this.sessions.persistAssistantToolCallMessage(params.childSessionId, callId, {
      agentId: params.agentId,
      workdir: params.workdir,
      prompt: params.prompt,
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
    };

    const completion = this.executeSessionTurn({
      snapshot: runningSnapshot,
      effectivePrompt,
      timeoutMs: params.timeoutMs,
      emit: params.emit,
      turnId,
      callId,
    });

    this.runtimeEntries.set(params.childSessionId, {
      snapshot: runningSnapshot,
      completion,
    });

    return runningSnapshot;
  }

  private async executeSessionTurn(params: {
    snapshot: CLIAgentSessionSnapshot;
    effectivePrompt: string;
    timeoutMs?: number;
    emit?: ToolCallRequest['_emit'];
    turnId: string;
    callId: string;
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
        timeoutMs: params.timeoutMs,
        emitFn: params.emit
          ? (event, data) => {
              this.updateRuntimeOutput(params.snapshot.childSessionId, data.chunk);
              params.emit?.(event, data);
            }
          : undefined,
      });

      return this.finalizeSuccess(params.snapshot.childSessionId, params.callId, params.turnId, params.emit, result);
    } catch (err: unknown) {
      return this.finalizeFailure(params.snapshot.childSessionId, params.callId, params.turnId, params.emit, err);
    }
  }

  private async finalizeSuccess(
    childSessionId: string,
    callId: string,
    turnId: string,
    emit: ToolCallRequest['_emit'] | undefined,
    result: CLIAgentResult,
  ): Promise<CLIAgentSessionSnapshot> {
    const current = this.runtimeEntries.get(childSessionId)?.snapshot;
    const completedSnapshot: CLIAgentSessionSnapshot = {
      childSessionId,
      parentSessionId: current?.parentSessionId ?? '',
      agentId: result.agentId,
      workdir: current?.workdir ?? '',
      status: result.exitCode === 0 ? 'completed' : 'failed',
      lastPrompt: current?.lastPrompt ?? '',
      updatedAt: Date.now(),
      startedAt: current?.startedAt,
      completedAt: Date.now(),
      lastOutput: result.output,
      lastExitCode: result.exitCode,
    };

    await this.sessions.saveToolResult(
      childSessionId,
      callId,
      JSON.stringify({
        ...completedSnapshot,
        output: result.output,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      }),
    );

    const toolResult: ToolResult = {
      callId,
      toolName: 'run_cli_agent',
      sessionId: childSessionId,
      status: result.exitCode === 0 ? 'success' : 'error',
      data: {
        ...result,
        childSessionId,
      },
    };

    emit?.('tool:result', toolResult);
    emit?.('agent:done', { sessionId: childSessionId, turnId });

    this.runtimeEntries.set(childSessionId, {
      snapshot: completedSnapshot,
      completion: Promise.resolve(completedSnapshot),
    });

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
    const stopped = error.message === CLI_AGENT_STOPPED_ERROR;
    const nextSnapshot: CLIAgentSessionSnapshot = {
      childSessionId,
      parentSessionId: current?.parentSessionId ?? '',
      agentId: current?.agentId ?? 'copilot',
      workdir: current?.workdir ?? '',
      status: stopped ? 'stopped' : 'failed',
      lastPrompt: current?.lastPrompt ?? '',
      updatedAt: Date.now(),
      startedAt: current?.startedAt,
      completedAt: Date.now(),
      lastOutput: stopped ? current?.lastOutput ?? 'CLI agent stopped.' : error.message,
      lastExitCode: stopped ? 130 : 1,
    };

    await this.sessions.saveToolResult(
      childSessionId,
      callId,
      JSON.stringify(nextSnapshot),
    );

    emit?.('tool:result', {
      callId,
      toolName: 'run_cli_agent',
      sessionId: childSessionId,
      status: stopped ? 'cancelled' : 'error',
      ...(stopped
        ? { data: nextSnapshot }
        : { errorCode: 'CLI_AGENT_ERROR', errorMessage: error.message }),
    });
    emit?.('agent:done', { sessionId: childSessionId, turnId });

    this.runtimeEntries.set(childSessionId, {
      snapshot: nextSnapshot,
      completion: Promise.resolve(nextSnapshot),
    });

    return nextSnapshot;
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
        typeof parsed['status'] !== 'string' ||
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
        status: parsed['status'] as CLIAgentSessionSnapshot['status'],
        lastPrompt: parsed['lastPrompt'],
        updatedAt: parsed['updatedAt'],
        startedAt: typeof parsed['startedAt'] === 'number' ? parsed['startedAt'] : undefined,
        completedAt: typeof parsed['completedAt'] === 'number' ? parsed['completedAt'] : undefined,
        activeCallId: typeof parsed['activeCallId'] === 'string' ? parsed['activeCallId'] : undefined,
        lastOutput: typeof parsed['lastOutput'] === 'string' ? parsed['lastOutput'] : typeof parsed['output'] === 'string' ? parsed['output'] : undefined,
        lastExitCode: typeof parsed['lastExitCode'] === 'number' ? parsed['lastExitCode'] : typeof parsed['exitCode'] === 'number' ? parsed['exitCode'] : undefined,
      };
    } catch {
      return null;
    }
  }

  private buildPromptFromHistory(history: ChatMessage[], nextPrompt: string): string {
    const visibleHistory = history
      .filter((message) => message.role !== 'system')
      .slice(-HISTORY_MESSAGE_LIMIT)
      .map((message) => this.formatHistoryMessage(message))
      .filter((message): message is string => message !== null);

    if (visibleHistory.length === 0) {
      return nextPrompt;
    }

    return [
      'You are continuing an existing Kalio CLI child session. The repository state may already reflect earlier work.',
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
}