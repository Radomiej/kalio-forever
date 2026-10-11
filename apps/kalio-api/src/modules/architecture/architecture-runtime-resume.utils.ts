import type { AgentFlowContinuationCursor, ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import type { ArchitectureGoalResumeInput, ArchitectureGoalRunResumeService } from './architecture-goal-run-resume.service';
import { recoverAutoRoutingCursor, type ArchitectureRuntimeResumeCursor } from './architecture-runtime-auto-routing-recovery.utils';

export const GOAL_ROUTE_RESUME = Symbol('GOAL_ROUTE_RESUME');
/** Host authority must verify durable ACKs, current goal/receipts and readmission.
 * A diagnostic candidate or a caller-supplied continuation is not authority. */
export interface GoalRouteResumePort {
  resolve(input: { run: ArchitectureRun; schema: ArchitectureSchema;
    events: readonly ArchitectureExecutionEvent[]; signal: AbortSignal }): Promise<ArchitectureRuntimeResumeCursor>;
}

export async function resolveArchitectureResumeCursor(run: ArchitectureRun, schema: ArchitectureSchema,
  dto: ArchitectureResumeInput, events: ArchitectureExecutionEvent[], signal: AbortSignal,
  goals?: GoalRouteResumePort): Promise<ArchitectureRuntimeResumeCursor | undefined> {
  if (signal.aborted) throw new Error('GOAL_RESUME_ABORTED');
  if (run.goalPacket === undefined && !(run.context && Object.hasOwn(run.context, 'goalProtocol'))) {
    return dto.continuation ?? recoverAutoRoutingCursor(schema, events);
  }
  if (!goals) throw new Error('GOAL_ROUTE_RESUME_UNAVAILABLE');
  let cursor: ArchitectureRuntimeResumeCursor;
  try { cursor = await goals.resolve({ run, schema, events, signal }); }
  catch (error) { if (signal.aborted) throw new Error('GOAL_RESUME_ABORTED', { cause: error }); throw error; }
  if (signal.aborted) throw new Error('GOAL_RESUME_ABORTED');
  if (!cursor) throw new Error('GOAL_ROUTE_RESUME_UNAVAILABLE');
  return cursor;
}

export interface ArchitectureResumeInput {
  input?: string;
  context?: Record<string, unknown>;
  maxSteps?: number;
  continuation?: AgentFlowContinuationCursor;
  goalResume?: Omit<ArchitectureGoalResumeInput, 'input'>;
}

export async function prepareArchitectureResume(existing: ArchitectureRun, schema: ArchitectureSchema,
  dto: ArchitectureResumeInput, events: ArchitectureExecutionEvent[], signal: AbortSignal,
  goals?: Pick<ArchitectureGoalRunResumeService, 'resume'>, routes?: GoalRouteResumePort):
  Promise<{ run: ArchitectureRun; continuation: ArchitectureRuntimeResumeCursor | undefined }> {
  if (signal.aborted) throw new Error('GOAL_RESUME_ABORTED');
  if ((existing.goalPacket !== undefined || existing.context && Object.hasOwn(existing.context, 'goalProtocol')) && !routes) {
    throw new Error('GOAL_ROUTE_RESUME_UNAVAILABLE');
  }
  let run: ArchitectureRun;
  try { run = await prepareArchitectureResumeRun(existing, dto, goals); }
  catch (error) { if (signal.aborted) throw new Error('GOAL_RESUME_ABORTED', { cause: error }); throw error; }
  const continuation = await resolveArchitectureResumeCursor(run, schema, dto, events, signal, routes);
  return { run, continuation };
}

export async function prepareArchitectureResumeRun(existing: ArchitectureRun, dto: ArchitectureResumeInput,
  goals?: Pick<ArchitectureGoalRunResumeService, 'resume'>): Promise<ArchitectureRun> {
  const required = existing.goalPacket !== undefined
    || (!!existing.context && Object.hasOwn(existing.context, 'goalProtocol'));
  if (required && !goals) throw new Error('GOAL_RESUME_UNAVAILABLE');
  if (required && dto.context && Object.hasOwn(dto.context, 'goalProtocol') && dto.context['goalProtocol'] !== 1) {
    throw new Error('GOAL_RESUME_PROTOCOL_INVALID');
  }
  const base = required ? await goals!.resume(existing, { ...dto.goalResume, input: dto.input }) : existing;
  return {
    ...base,
    prompt: required ? base.prompt
      : dto.input?.trim() ? `${base.prompt}\n\nResume input: ${dto.input.trim()}` : base.prompt,
    context: { ...(base.context ?? {}), ...(dto.context ?? {}),
      ...(dto.maxSteps !== undefined ? { maxArchitectureSteps: dto.maxSteps } : {}) },
    status: 'running', updatedAt: Date.now(), completedAt: undefined,
  };
}
