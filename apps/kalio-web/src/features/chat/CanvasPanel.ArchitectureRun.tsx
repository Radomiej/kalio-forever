import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  GitBranch,
  Loader2,
  Route,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { ArchitectureChatRunSummary, ChatMessage, ChatSession } from '@kalio/types';
import { compactArchitectureTraceContent } from './architectureChatSummary';
import {
  buildTimelineStages,
  graphStepCount,
  nodeLabel,
  statusForStep,
  type TimelineStatus,
  type TraceStage,
  type TraceStep,
} from './ArchitectureRunTimeline.stages';

type ArchitectureRunFocusedStep = { eventId?: string; nodeId?: string };

function isFocusedTraceStep(step: TraceStep, focusedStep: ArchitectureRunFocusedStep | undefined): boolean {
  if (!focusedStep) {
    return false;
  }
  if (focusedStep.eventId && step.eventId === focusedStep.eventId) {
    return true;
  }
  return Boolean(focusedStep.nodeId && step.nodeId === focusedStep.nodeId);
}

function compact(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function findSessionTitle(sessions: ChatSession[], sessionId: string): string {
  return sessions.find((session) => session.id === sessionId)?.title ?? sessionId;
}

function isKnownBranchSession(
  sessionId: string | undefined,
  knownBranchSessionIds: ReadonlySet<string> | undefined,
): sessionId is string {
  return typeof sessionId === 'string'
    && sessionId.trim().length > 0
    && (knownBranchSessionIds === undefined || knownBranchSessionIds.has(sessionId));
}

function visibleTranscript(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-3);
}

function isSameStep(
  left: Pick<TraceStep, 'eventId' | 'nodeId'> | undefined,
  right: Pick<TraceStep, 'eventId' | 'nodeId'> | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }
  if (left.eventId && right.eventId) {
    return left.eventId === right.eventId;
  }
  return Boolean(left.nodeId && right.nodeId && left.nodeId === right.nodeId);
}

function branchSessionCandidates(runId: string, step: TraceStep): string[] {
  const fromStream = step.stream?.branchSessionId;
  if (fromStream) {
    return [fromStream];
  }
  if (step.speaker !== 'participant' || !step.nodeId) {
    return [];
  }
  const raw = step.nodeId;
  const normalized = new Set([
    raw,
    raw.replace(/-/g, '_'),
    raw.replace(/_/g, '-'),
  ]);
  return [...normalized].map((nodeId) => `arch-${runId}-${nodeId}`);
}

function resolveBranchSessionId(
  runId: string,
  step: TraceStep,
  knownBranchSessionIds: ReadonlySet<string> | undefined,
): string | undefined {
  return branchSessionCandidates(runId, step).find((sessionId) => isKnownBranchSession(sessionId, knownBranchSessionIds));
}

function TimelineStatusIcon({
  status,
}: {
  status: TimelineStatus;
}) {
  if (status === 'pending') {
    return <Circle size={10} className="text-base-content/40" />;
  }
  if (status === 'waiting') {
    return <AlertTriangle size={10} className="text-warning" />;
  }
  if (status === 'running') {
    return <Loader2 size={10} className="animate-spin text-sky-300" />;
  }
  if (status === 'completed') {
    return <CheckCircle2 size={10} className="text-emerald-300" />;
  }
  return <XCircle size={10} className="text-rose-300" />;
}

function StatusBadge({ status }: { status: TimelineStatus | null }) {
  if (!status) {
    return null;
  }
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-base-100/80 px-1 text-[9px] font-mono text-base-content/80">
      <TimelineStatusIcon status={status} />
      {status}
    </span>
  );
}

function stepLabel(step: TraceStep, label?: string): string {
  if (label) {
    return label;
  }
  if (step.speaker === 'finalizer') {
    return 'Finalizer';
  }
  return nodeLabel(step);
}

function routerLabel(
  step: TraceStep,
  firstRouter: TraceStep | undefined,
  finalRouter: TraceStep | undefined,
  hasParallelStage: boolean,
  hasMerge: boolean,
): string {
  if (hasParallelStage && isSameStep(step, firstRouter)) {
    return 'Router dispatch';
  }
  if (hasMerge && isSameStep(step, finalRouter)) {
    return 'Router merge';
  }
  return stepLabel(step);
}

function ArchitectureTraceCard({
  runId,
  step,
  sessions,
  onOpenSession,
  label,
  transcript = [],
  focused = false,
  knownBranchSessionIds,
}: {
  runId: string;
  step: TraceStep;
  sessions: ChatSession[];
  onOpenSession: (sessionId: string) => void;
  label?: string;
  transcript?: ChatMessage[];
  focused?: boolean;
  knownBranchSessionIds?: ReadonlySet<string>;
}) {
  const openableBranchSessionId = resolveBranchSessionId(runId, step, knownBranchSessionIds);
  const visibleMessages = visibleTranscript(transcript);
  const tone = step.speaker === 'participant'
    ? 'border-sky-500/20 bg-sky-500/5'
    : step.speaker === 'router'
      ? 'border-amber-500/20 bg-amber-500/5'
      : 'border-emerald-500/20 bg-emerald-500/5';
  const status = statusForStep(step);
  const stepTestId = step.eventId ?? step.nodeId ?? stepLabel(step).replace(/\s+/g, '-').toLowerCase();

  return (
    <div
      className={`rounded-xl border px-3 py-2 text-xs space-y-2 ${tone} ${focused ? 'ring-1 ring-sky-300/70 shadow-[0_0_0_1px_rgba(125,211,252,0.26)]' : ''}`}
      data-testid={`architecture-run-step-${stepTestId}`}
      data-focused-step={focused ? 'true' : 'false'}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 rounded-md border border-base-content/10 bg-base-200/60 p-1">
          {step.speaker === 'participant' ? <GitBranch size={11} /> : <Route size={11} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-base-content truncate">{stepLabel(step, label)}</p>
          <p className="text-[10px] uppercase tracking-wide text-base-content/40">
            {step.speaker}
            {step.nextNodeId ? ` -> ${step.nextNodeId}` : ''}
          </p>
        </div>
        <StatusBadge status={status} />
        {openableBranchSessionId && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => onOpenSession(openableBranchSessionId)}
            data-testid={`architecture-open-branch-${openableBranchSessionId}`}
            data-session-id={openableBranchSessionId}
            title={findSessionTitle(sessions, openableBranchSessionId)}
          >
            Open
          </button>
        )}
      </div>
      <p className="text-base-content/65 leading-relaxed line-clamp-4">
        {compact(compactArchitectureTraceContent(step.content, step.speaker))}
      </p>
      {openableBranchSessionId && (
        <div className="space-y-1" data-testid={`architecture-run-branch-transcript-${openableBranchSessionId}`}>
          {visibleMessages.length > 0 ? (
            visibleMessages.map((message) => (
              <div key={message.id} className="rounded bg-base-200/65 px-2 py-1">
                <span className="text-base-content/35 mr-1">{message.role === 'user' ? 'User:' : 'Agent:'}</span>
                <span className="text-base-content/70 whitespace-pre-wrap break-words">{message.content}</span>
              </div>
            ))
          ) : (
            <p className="rounded bg-base-200/65 px-2 py-1 text-base-content/45">
              Branch transcript is loading.
            </p>
          )}
        </div>
      )}
      {step.stream && (
        <div className="flex gap-2 text-[10px] font-mono text-base-content/45">
          <span>{step.stream.status}</span>
          <span>{step.stream.chunkCount} chunks</span>
        </div>
      )}
    </div>
  );
}

function ArchitectureParallelGroup({
  runId,
  steps,
  sessions,
  onOpenSession,
  getBranchMessages,
  focusedStep,
  knownBranchSessionIds,
}: {
  runId: string;
  steps: TraceStep[];
  sessions: ChatSession[];
  onOpenSession: (sessionId: string) => void;
  getBranchMessages: (sessionId: string) => ChatMessage[];
  focusedStep?: ArchitectureRunFocusedStep;
  knownBranchSessionIds?: ReadonlySet<string>;
}) {
  if (steps.length === 0) return null;

  return (
    <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-2" data-testid="architecture-run-parallel-group">
      <div className="mb-2 flex items-center gap-2">
        <GitBranch size={12} className="text-sky-300" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-base-content">Parallel sub-agents</p>
          <p className="text-[10px] text-base-content/45">
            {steps.length} branch{steps.length === 1 ? '' : 'es'} execute from the router output.
          </p>
        </div>
        <span className="rounded bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-mono text-sky-200" data-testid="architecture-run-branch-count">
          {steps.length}
        </span>
      </div>
      <div className="space-y-1.5" data-testid="architecture-run-branches">
        {steps.map((step) => (
          (() => {
            const branchSessionId = resolveBranchSessionId(runId, step, knownBranchSessionIds);
            return (
              <ArchitectureTraceCard
                key={step.eventId ?? `${step.nodeId}-${step.visitIndex ?? 0}`}
                runId={runId}
                step={step}
                sessions={sessions}
                onOpenSession={onOpenSession}
                transcript={branchSessionId ? getBranchMessages(branchSessionId) : []}
                focused={isFocusedTraceStep(step, focusedStep)}
                knownBranchSessionIds={knownBranchSessionIds}
              />
            );
          })()
        ))}
      </div>
    </div>
  );
}

function ArchitectureFlowSeparator() {
  return (
    <div className="flex justify-center py-0.5" aria-hidden="true">
      <div className="h-4 w-px bg-base-content/15" />
    </div>
  );
}

function ArchitectureSequentialFlow({
  runId,
  stages,
  sessions,
  onOpenSession,
  getBranchMessages,
  focusedStep,
  firstRouter,
  finalRouter,
  hasParallelStage,
  hasMerge,
  knownBranchSessionIds,
}: {
  runId: string;
  stages: TraceStage[];
  sessions: ChatSession[];
  onOpenSession: (sessionId: string) => void;
  getBranchMessages: (sessionId: string) => ChatMessage[];
  focusedStep?: ArchitectureRunFocusedStep;
  firstRouter?: TraceStep;
  finalRouter?: TraceStep;
  hasParallelStage: boolean;
  hasMerge: boolean;
  knownBranchSessionIds?: ReadonlySet<string>;
}) {
  return (
    <div className="space-y-1.5" data-testid="architecture-run-sequential-flow">
      {stages.map((stage, index) => (
        <div
          key={stage.kind === 'parallel' ? `parallel-${index}` : stage.step.eventId ?? `${stage.step.speaker}-${stage.step.nodeId ?? index}`}
          data-testid={stage.kind === 'parallel' ? 'architecture-run-sequential-parallel-stage' : 'architecture-run-sequential-step'}
        >
          {stage.kind === 'parallel' ? (
            <ArchitectureParallelGroup
              runId={runId}
              steps={stage.steps}
              sessions={sessions}
              onOpenSession={onOpenSession}
              getBranchMessages={getBranchMessages}
              focusedStep={focusedStep}
              knownBranchSessionIds={knownBranchSessionIds}
            />
          ) : (
            (() => {
              const branchSessionId = resolveBranchSessionId(runId, stage.step, knownBranchSessionIds);
              return (
                <ArchitectureTraceCard
                  runId={runId}
                  step={stage.step}
                  sessions={sessions}
                  onOpenSession={onOpenSession}
                  label={stage.step.speaker === 'router'
                    ? routerLabel(stage.step, firstRouter, finalRouter, hasParallelStage, hasMerge)
                    : stage.step.speaker === 'finalizer'
                      ? 'Finalizer'
                      : undefined}
                  transcript={branchSessionId ? getBranchMessages(branchSessionId) : []}
                  focused={isFocusedTraceStep(stage.step, focusedStep)}
                  knownBranchSessionIds={knownBranchSessionIds}
                />
              );
            })()
          )}
          {index < stages.length - 1 && <ArchitectureFlowSeparator />}
        </div>
      ))}
    </div>
  );
}

function ArchitectureTranscriptEntry({
  runId,
  step,
  getBranchMessages,
  label,
  knownBranchSessionIds,
}: {
  runId: string;
  step: TraceStep;
  getBranchMessages: (sessionId: string) => ChatMessage[];
  label?: string;
  knownBranchSessionIds?: ReadonlySet<string>;
}) {
  const openableBranchSessionId = resolveBranchSessionId(runId, step, knownBranchSessionIds);
  const transcript = openableBranchSessionId ? visibleTranscript(getBranchMessages(openableBranchSessionId)) : [];

  return (
    <div className="rounded-lg border border-base-300 bg-base-200/30 px-2.5 py-2 text-xs" data-testid="architecture-run-transcript-entry">
      <div className="mb-1 flex items-center gap-2">
        {step.speaker === 'participant' ? (
          <GitBranch size={11} className="text-sky-300" />
        ) : step.speaker === 'router' ? (
          <Route size={11} className="text-amber-300" />
        ) : (
          <ShieldCheck size={11} className="text-emerald-300" />
        )}
        <p className="font-medium text-base-content">{stepLabel(step, label)}</p>
        <span className="ml-auto rounded bg-base-100/70 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-base-content/45">
          {step.speaker}
        </span>
      </div>
      <p className="mb-1 text-[10px] font-mono text-base-content/40">
        {step.nodeId ?? step.speaker}{step.nextNodeId ? ` -> ${step.nextNodeId}` : ''}
      </p>
      <p className="text-base-content/60 leading-relaxed">
        {compact(compactArchitectureTraceContent(step.content, step.speaker))}
      </p>
      {openableBranchSessionId && transcript.length > 0 && (
        <div className="mt-1 space-y-1" data-testid={`architecture-run-transcript-branch-${openableBranchSessionId}`}>
          {transcript.map((message) => (
            <div key={message.id} className="rounded bg-base-100/65 px-2 py-1">
              <span className="text-base-content/35 mr-1">{message.role === 'user' ? 'User:' : 'Agent:'}</span>
              <span className="text-base-content/70 whitespace-pre-wrap break-words">{message.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ArchitectureRunCanvasSection({
  run,
  sessions,
  onOpenSession,
  getBranchMessages,
  focused = false,
  focusedStep,
  knownBranchSessionIds,
}: {
  run: ArchitectureChatRunSummary;
  sessions: ChatSession[];
  onOpenSession: (sessionId: string) => void;
  getBranchMessages: (sessionId: string) => ChatMessage[];
  focused?: boolean;
  focusedStep?: ArchitectureRunFocusedStep;
  knownBranchSessionIds?: ReadonlySet<string>;
}) {
  const stages = buildTimelineStages(run);
  const stepCount = graphStepCount(run);
  const routers = stages
    .filter((stage): stage is Extract<TraceStage, { kind: 'step' }> => stage.kind === 'step' && stage.step.speaker === 'router')
    .map((stage) => stage.step);
  const firstRouter = routers[0];
  const finalRouter = routers.at(-1);
  const hasParallelStage = stages.some((stage) => stage.kind === 'parallel');
  const hasMerge = hasParallelStage && Boolean(finalRouter && !isSameStep(finalRouter, firstRouter));
  const routeText = stages.map((stage) => {
    if (stage.kind === 'parallel') return 'Sub-agents';
    if (stage.step.speaker === 'router') return 'Router';
    return stepLabel(stage.step);
  }).join(' -> ');

  return (
    <section
      data-testid="architecture-run-canvas-section"
      data-focused={focused ? 'true' : 'false'}
      className={focused ? 'rounded-xl ring-1 ring-sky-400/40 ring-offset-0' : undefined}
    >
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck size={12} className="text-sky-400" />
        <p className="text-[10px] uppercase tracking-wide text-base-content/40">Architecture run</p>
      </div>
      <div className="rounded-xl border border-base-300 bg-base-200/35 px-3 py-2 text-xs mb-2">
        <p className="font-medium text-base-content truncate">{run.schemaId}</p>
        <p className="text-base-content/45 font-mono">{run.status} / {stepCount} steps</p>
      </div>

      <div className="space-y-1.5" data-testid="architecture-run-flow">
        <ArchitectureSequentialFlow
          runId={run.runId}
          stages={stages}
          sessions={sessions}
          onOpenSession={onOpenSession}
          getBranchMessages={getBranchMessages}
          focusedStep={focusedStep}
          firstRouter={firstRouter}
          finalRouter={finalRouter}
          hasParallelStage={hasParallelStage}
          hasMerge={hasMerge}
          knownBranchSessionIds={knownBranchSessionIds}
        />
        <div className="hidden" data-testid="architecture-run-routing">{routeText}</div>
      </div>

      <div className="mt-3 space-y-1.5" data-testid="architecture-run-internal-transcript">
        <p className="text-[10px] uppercase tracking-wide text-base-content/40">Internal transcript</p>
        {run.trace.map((step, index) => (
          <ArchitectureTranscriptEntry
            key={step.eventId ?? `${step.speaker}-${step.nodeId ?? index}-${step.visitIndex ?? 0}`}
            runId={run.runId}
            step={step}
            getBranchMessages={getBranchMessages}
            label={step.speaker === 'router'
              ? routerLabel(step, firstRouter, finalRouter, hasParallelStage, hasMerge)
              : step.speaker === 'finalizer'
                ? 'Finalizer'
                : undefined}
            knownBranchSessionIds={knownBranchSessionIds}
          />
        ))}
      </div>
    </section>
  );
}
