import { AlertTriangle, CheckCircle2, Circle, GitBranch, Loader2, Route, ShieldCheck, XCircle } from 'lucide-react';
import type { ArchitectureChatRunSummary } from '@kalio/types';
import { compactArchitectureTraceContent } from './architectureChatSummary';
import {
  buildTimelineStages,
  graphStepCount,
  nodeLabel,
  stageSegment,
  statusForStep,
  stepFocus,
  type TimelineStatus,
  type TraceStage,
  type TraceStep,
} from './ArchitectureRunTimeline.stages';

function compact(step: TraceStep): string {
  return compactArchitectureTraceContent(step.content, step.speaker).replace(/\s+/g, ' ').trim();
}

function shortSummary(step: TraceStep, maxLength = 120): string {
  const fullText = compactArchitectureTraceContent(step.content, step.speaker);
  const summary = fullText
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => (
      line.length > 0
      && !/^#{1,6}\s/.test(line)
      && !/^\|/.test(line)
      && !/^[-|:\s]+$/.test(line)
    ))
    ?.replace(/^[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .trim() ?? compact(step);
  if (summary.length <= maxLength) {
    return summary;
  }
  return `${summary.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
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

function RouterStep({
  step,
  label,
  onOpenStep,
}: {
  step: TraceStep | undefined;
  label: string;
  onOpenStep: (step: TraceStep) => void;
}) {
  const routerOutput = step?.routerOutput;
  const status = statusForStep(step);
  const contractIsFallback = routerOutput
    ? routerOutput.acceptedInputs.every((input) => /^Input from\s/i.test(input.insight))
    : false;

  return (
    <button
      type="button"
      className="w-full rounded-lg border border-amber-400/20 bg-amber-400/5 px-2.5 py-2 text-left transition-colors hover:border-amber-300/40 hover:bg-amber-400/10 disabled:cursor-default disabled:hover:border-amber-400/20 disabled:hover:bg-amber-400/5"
      data-testid="architecture-route-router"
      onClick={() => step && onOpenStep(step)}
      disabled={!step}
    >
      <div className="flex items-center gap-2">
        <Route size={12} className="text-amber-300" />
        <span className="text-xs font-medium text-base-content">{label}</span>
        {step?.nextNodeId && (
          <span className="text-[10px] font-mono text-base-content/70">to {step.nextNodeId}</span>
        )}
        <StatusBadge status={status} />
      </div>
      {step?.content && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-base-content/55" title={compact(step)}>
          {shortSummary(step)}
        </p>
      )}
      {routerOutput && (
        <div className="mt-2 grid gap-1.5 rounded-md border border-amber-400/15 bg-base-100/40 p-2" data-testid="architecture-router-contract">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-mono text-amber-200">
              confidence {Math.round(routerOutput.confidence * 100)}%
            </span>
            <span className="rounded bg-base-300/70 px-1.5 py-0.5 text-[10px] font-mono text-base-content/70">
              {routerOutput.nextAction}
            </span>
            <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-200">
              +{routerOutput.acceptedInputs.length}
            </span>
            {routerOutput.rejectedInputs.length > 0 && (
              <span className="rounded bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-mono text-rose-200">
                -{routerOutput.rejectedInputs.length}
              </span>
            )}
            {contractIsFallback && (
              <span className="rounded border border-amber-300/30 bg-amber-300/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-100">
                fallback contract
              </span>
            )}
          </div>
          <p className="line-clamp-2 text-[10px] leading-relaxed text-base-content/55">
            {routerOutput.selectedStrategy}: {routerOutput.mergedDecision}
          </p>
        </div>
      )}
    </button>
  );
}

function AgentStep({
  step,
  canOpenBranchSession,
  onOpenBranch,
  onOpenStep,
}: {
  step: TraceStep;
  canOpenBranchSession: (sessionId: string | undefined) => boolean;
  onOpenBranch: (sessionId: string) => void;
  onOpenStep: (step: TraceStep) => void;
}) {
  const branchSessionId = step.stream?.branchSessionId;
  const openableBranchSessionId = canOpenBranchSession(branchSessionId) ? branchSessionId : undefined;
  const status = statusForStep(step);

  return (
    <button
      type="button"
      className="min-w-0 rounded-lg border border-sky-400/20 bg-sky-400/5 px-2.5 py-2 text-left transition-colors hover:border-sky-400/40 hover:bg-sky-400/10 disabled:cursor-default disabled:hover:border-sky-400/20 disabled:hover:bg-sky-400/5"
      data-testid="architecture-route-agent"
      data-session-id={openableBranchSessionId}
      onClick={() => {
        if (openableBranchSessionId) {
          onOpenBranch(openableBranchSessionId);
          return;
        }
        onOpenStep(step);
      }}
    >
      <div className="flex items-center gap-2">
        <GitBranch size={12} className="text-sky-300" />
        <span className="truncate text-xs font-medium text-base-content">{nodeLabel(step)}</span>
        <StatusBadge status={status} />
      </div>
      {step.content && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-base-content/55" title={compact(step)}>
          {shortSummary(step)}
        </p>
      )}
    </button>
  );
}

function ParallelBranches({
  steps,
  canOpenBranchSession,
  onOpenBranch,
  onOpenStep,
}: {
  steps: TraceStep[];
  canOpenBranchSession: (sessionId: string | undefined) => boolean;
  onOpenBranch: (sessionId: string) => void;
  onOpenStep: (step: TraceStep) => void;
}) {
  return (
    <div className="rounded-lg border border-sky-400/20 bg-sky-400/5 px-2.5 py-2" data-testid="architecture-route-parallel-agents">
      <div className="mb-2 flex items-center gap-2">
        <GitBranch size={12} className="text-sky-300" />
        <span className="text-xs font-medium text-base-content">Parallel sub-agents</span>
        <span className="ml-auto rounded bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-mono text-sky-200">
          {steps.length}
        </span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {steps.map((step) => {
          const branchSessionId = step.stream?.branchSessionId;
          const openableBranchSessionId = canOpenBranchSession(branchSessionId) ? branchSessionId : undefined;
          const status = statusForStep(step);
          return (
          <button
            type="button"
            key={step.eventId ?? `${step.nodeId}-${step.visitIndex ?? 0}`}
            className="min-w-0 rounded-md border border-base-content/10 bg-base-300/45 px-2 py-1.5 text-left transition-colors hover:border-sky-400/40 hover:bg-sky-400/10 disabled:cursor-default disabled:hover:border-base-content/10 disabled:hover:bg-base-300/45"
            data-testid="architecture-route-agent"
            data-session-id={openableBranchSessionId}
            onClick={() => {
              if (openableBranchSessionId) {
                onOpenBranch(openableBranchSessionId);
                return;
              }
              onOpenStep(step);
            }}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[11px] font-medium text-base-content">{nodeLabel(step)}</span>
              <StatusBadge status={status} />
            </div>
            {step.content && (
              <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-base-content/50" title={compact(step)}>
                {shortSummary(step, 92)}
              </p>
            )}
          </button>
          );
        })}
      </div>
    </div>
  );
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

function FinalizerStep({
  step,
  onOpenStep,
}: {
  step: TraceStep | undefined;
  onOpenStep: (step: TraceStep) => void;
}) {
  const status = statusForStep(step);
  return (
    <button
      type="button"
      className="w-full rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-2 text-left transition-colors hover:border-emerald-300/40 hover:bg-emerald-400/10 disabled:cursor-default disabled:hover:border-emerald-400/20 disabled:hover:bg-emerald-400/5"
      data-testid="architecture-route-finalizer"
      onClick={() => step && onOpenStep(step)}
      disabled={!step}
    >
      <div className="flex items-center gap-2">
        <ShieldCheck size={12} className="text-emerald-300" />
        <span className="text-xs font-medium text-base-content">Finalizer</span>
        <StatusBadge status={status} />
      </div>
      {step?.content && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-base-content/55" title={compact(step)}>
          {shortSummary(step)}
        </p>
      )}
    </button>
  );
}

function RouteShell({
  segments,
}: {
  segments: Array<{ label: string; tone: string }>;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="architecture-route-shell">
      {segments.map((segment, index) => (
        <div key={`${segment.label}-${index}`} className="flex items-center gap-1.5">
          {index > 0 && <span className="text-[10px] text-base-content/70"> -&gt; </span>}
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${segment.tone}`}>
            {segment.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ArchitectureRunTimeline({
  run,
  onOpenCanvas,
  onOpenBranch,
  onOpenStep,
  knownBranchSessionIds,
}: {
  run: ArchitectureChatRunSummary;
  onOpenCanvas: () => void;
  onOpenBranch: (sessionId: string) => void;
  onOpenStep?: (focus: { eventId?: string; nodeId?: string }) => void;
  knownBranchSessionIds?: ReadonlySet<string>;
}) {
  const stages = buildTimelineStages(run);
  const routers = stages
    .filter((stage): stage is Extract<TraceStage, { kind: 'step' }> => stage.kind === 'step' && stage.step.speaker === 'router')
    .map((stage) => stage.step);
  const firstRouter = routers[0];
  const finalRouter = routers.at(-1);
  const hasMerge = Boolean(finalRouter && finalRouter !== firstRouter);
  const shellSegments = stages.map(stageSegment);
  const stepCount = graphStepCount(run);
  const canOpenBranchSession = (sessionId: string | undefined) => (
    typeof sessionId === 'string'
    && sessionId.trim().length > 0
    && (knownBranchSessionIds === undefined || knownBranchSessionIds.has(sessionId))
  );
  const openStep = (step: TraceStep) => {
    onOpenStep?.(stepFocus(step));
  };

  return (
    <div className="space-y-2 rounded-xl border border-sky-400/20 bg-base-200/45 p-2.5 shadow-sm shadow-sky-950/20" data-testid="architecture-run-timeline">
      <div className="flex items-start gap-2">
        <GitBranch size={13} className="text-sky-300" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-base-content">{run.schemaId}</p>
          <p className="text-[10px] font-mono text-base-content/75">{run.status} / {stepCount} graph steps</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={onOpenCanvas}
          data-testid="open-architecture-run-canvas"
        >
          Details
        </button>
      </div>

      <RouteShell segments={shellSegments} />

      <div className="grid gap-2 border-l border-sky-400/20 pl-2">
        {stages.map((stage, index) => {
          if (stage.kind === 'parallel') {
            return (
              <ParallelBranches
                key={`parallel-${index}`}
                steps={stage.steps}
                canOpenBranchSession={canOpenBranchSession}
                onOpenBranch={onOpenBranch}
                onOpenStep={openStep}
              />
            );
          }

          const { step } = stage;
            if (step.speaker === 'participant') {
              return (
                <AgentStep
                  key={step.eventId ?? `${step.nodeId}-${index}`}
                  step={step}
                  canOpenBranchSession={canOpenBranchSession}
                  onOpenBranch={onOpenBranch}
                  onOpenStep={openStep}
                />
              );
            }
            if (step.speaker === 'router') {
              const label = step === firstRouter ? 'Router dispatch' : step === finalRouter && hasMerge ? 'Router merge' : nodeLabel(step);
              return <RouterStep key={step.eventId ?? `${step.nodeId}-${index}`} step={step} label={label} onOpenStep={openStep} />;
            }
            if (step.speaker === 'finalizer') {
              return <FinalizerStep key={step.eventId ?? `${step.nodeId}-${index}`} step={step} onOpenStep={openStep} />;
            }
            return null;
        })}
      </div>
    </div>
  );
}
