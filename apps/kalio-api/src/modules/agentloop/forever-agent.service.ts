import { Injectable, Logger } from '@nestjs/common';
import type { AgentLoop } from '@kalio/types';
import { LLMService } from '../llm/llm.service';
import { ToolRegistryService } from '../tool/tool-registry.service';
import { AgentLoopService } from './agent-loop.service';

interface ActiveLoop {
  loopId: string;
  abortController: AbortController;
}

@Injectable()
export class ForeverAgentService {
  private readonly logger = new Logger(ForeverAgentService.name);
  private activeLoops = new Map<string, ActiveLoop>();
  private gateway?: { emitToAll(event: string, data: unknown): void };

  constructor(
    private readonly llm: LLMService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly loopService: AgentLoopService,
  ) {}

  setGateway(gw: { emitToAll(event: string, data: unknown): void }): void {
    this.gateway = gw;
  }

  startLoop(loopId: string): void {
    if (this.activeLoops.has(loopId)) throw new Error(`Loop ${loopId} is already running`);
    const abortController = new AbortController();
    this.activeLoops.set(loopId, { loopId, abortController });
    void this.loopService.updateLoop(loopId, { status: 'running' });
    this.emit('agentLoop:stateChange', { loopId, status: 'running' });
    this.runLoop(loopId, abortController.signal).catch((err: Error) => {
      if (err.message !== '__cancelled__') {
        this.logger.error(`[ForeverAgent] Loop ${loopId} crashed: ${err.message}`);
        void this.loopService.updateLoop(loopId, { status: 'error' });
        this.emit('agentLoop:error', { loopId, error: err.message });
      }
      this.activeLoops.delete(loopId);
    });
  }

  pauseLoop(loopId: string): void {
    const active = this.activeLoops.get(loopId);
    if (!active) throw new Error(`Loop ${loopId} is not active`);
    active.abortController.abort();
    this.activeLoops.delete(loopId);
    void this.loopService.updateLoop(loopId, { status: 'paused', currentTaskId: null });
    this.emit('agentLoop:stateChange', { loopId, status: 'paused' });
  }

  stopLoop(loopId: string): void {
    const active = this.activeLoops.get(loopId);
    if (active) {
      active.abortController.abort();
      this.activeLoops.delete(loopId);
    }
    void this.loopService.updateLoop(loopId, { status: 'stopped', currentTaskId: null });
    this.emit('agentLoop:stateChange', { loopId, status: 'stopped' });
  }

  isRunning(loopId: string): boolean {
    return this.activeLoops.has(loopId);
  }

  private async runLoop(loopId: string, signal: AbortSignal): Promise<void> {
    let loop = await this.loopService.findLoop(loopId);
    if (!loop) return;

    const config = loop.config;
    const maxIterations = config.maxIterations ?? 1000;
    const delayMs = config.iterationDelayMs ?? 1000;
    const maxConsecutiveFailures = config.maxConsecutiveFailures ?? 5;
    let consecutiveFailures = 0;

    while (loop.iterationCount < maxIterations) {
      this.checkCancelled(signal);

      const task = await this.loopService.getNextPendingTask(loopId);

      if (!task) {
        const mode = config.mode ?? 'continuous';
        if (mode === 'watchdog') {
          const watchdogMs = config.watchdogIntervalMs ?? 5 * 60_000;
          this.emit('agentLoop:watchdog', { loopId, message: `No pending tasks. Checking again in ${Math.round(watchdogMs / 60_000)} min...` });
          await this.delay(watchdogMs, signal);
          loop = (await this.loopService.findLoop(loopId))!;
          continue;
        }
        this.emit('agentLoop:idle', { loopId, message: 'No pending tasks — loop paused' });
        await this.loopService.updateLoop(loopId, { status: 'paused', currentTaskId: null });
        this.activeLoops.delete(loopId);
        return;
      }

      const startTime = Date.now();
      await this.loopService.updateLoop(loopId, { currentTaskId: task.id });
      await this.loopService.updateTask(task.id, { status: 'running' });
      this.emit('agentLoop:taskStarted', { loopId, taskId: task.id });

      let resultSummary = '';
      try {
        resultSummary = await this.executeTask(loop, task, signal);
        await this.loopService.updateTask(task.id, { status: 'done', resultSummary });
        this.emit('agentLoop:taskDone', { loopId, taskId: task.id, resultSummary });
        consecutiveFailures = 0;
      } catch (err) {
        if ((err as Error).message === '__cancelled__') throw err;
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[ForeverAgent] Task ${task.id} failed: ${errMsg}`);
        await this.loopService.updateTask(task.id, { status: 'failed', resultSummary: errMsg });
        this.emit('agentLoop:error', { loopId, taskId: task.id, error: errMsg });
        resultSummary = `FAILED: ${errMsg}`;
        consecutiveFailures++;
        if (consecutiveFailures >= maxConsecutiveFailures) {
          await this.loopService.updateLoop(loopId, { status: 'error', currentTaskId: null });
          this.emit('agentLoop:error', { loopId, error: `Stopped after ${consecutiveFailures} consecutive failures` });
          this.activeLoops.delete(loopId);
          return;
        }
      }

      const durationMs = Date.now() - startTime;
      const newIterationCount = loop.iterationCount + 1;
      await this.loopService.createIteration({
        loopId,
        taskId: task.id,
        iterationNumber: newIterationCount,
        action: 'execute_task',
        promptUsed: task.title,
        resultSummary,
        durationMs,
      });
      await this.loopService.updateLoop(loopId, { iterationCount: newIterationCount, currentTaskId: null });
      this.emit('agentLoop:stateChange', { loopId, status: 'running', iterationCount: newIterationCount });

      loop = (await this.loopService.findLoop(loopId))!;
      this.checkCancelled(signal);
      await this.delay(delayMs, signal);
    }

    await this.loopService.updateLoop(loopId, { status: 'stopped', currentTaskId: null });
    this.emit('agentLoop:complete', { loopId, totalIterations: loop.iterationCount });
    this.activeLoops.delete(loopId);
  }

  private async executeTask(loop: AgentLoop, task: { id: string; title: string; description: string }, signal: AbortSignal): Promise<string> {
    const tools = this.toolRegistry.getAllTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    const allTasks = await this.loopService.findTasks(loop.id);
    const todoList = allTasks
      .map((t) => {
        if (t.id === task.id) return `- [→] ${t.title} (CURRENT)`;
        if (t.status === 'done') return `- [x] ${t.title}`;
        if (t.status === 'failed') return `- [✗] ${t.title}`;
        return `- [ ] ${t.title}`;
      })
      .join('\n');

    const systemPrompt = [
      loop.systemPrompt || 'You are an autonomous agent completing tasks.',
      '',
      'Current TODO list:',
      todoList,
    ].join('\n');

    const userMessage = task.description?.trim()
      ? `${task.title}\n\n${task.description}`
      : task.title;

    const messageId = `loop-${loop.id}-${task.id}`;
    let finalContent = '';

    await this.llm.streamChat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      tools,
      (chunk) => {
        if (signal.aborted) return;
        if (chunk.delta) {
          finalContent += chunk.delta;
          this.emit('agentLoop:taskProgress', { loopId: loop.id, taskId: task.id, delta: chunk.delta });
        }
      },
      messageId,
      messageId,
    );

    return finalContent || `Task "${task.title}" completed.`;
  }

  private checkCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw new Error('__cancelled__');
  }

  private async delay(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('__cancelled__')); }, { once: true });
    });
  }

  private emit(event: string, data: unknown): void {
    this.gateway?.emitToAll(event, data);
  }
}
