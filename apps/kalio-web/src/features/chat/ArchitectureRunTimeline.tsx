import { AlertTriangle, CheckCircle2, GitBranch, Loader2, Route, ShieldCheck, XCircle } from 'lucide-react';
import type { ArchitectureChatRunSummary } from '@kalio/types';
import { compactArchitectureTraceContent } from './architectureChatSummary';

type TraceStep = ArchitectureChatRunSummary['trace'][number];
type TraceStage =
  | { kind: 'step'; step: TraceStep }
  | { kind: 'parallel'; steps: TraceStep[] };

function nodeLabel(step: TraceStep): string {
  const raw = step.nodeId ?? step.nextNodeId ?? step.speaker;
  return raw
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

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

function routeSegmentLabel(step: TraceStep): string {
  if (step.speaker === 'participant') return nodeLabel(step);
  if (step.speaker === 'router') return 'Router';
  if (step.speaker === 'finalizer') return 'Finalizer';
  return nodeLabel(step);
}

function buildTraceStages(trace: TraceStep[]): TraceStage[] {
  const stages: TraceStage[] = [];
  let participantBuffer: TraceStep[] = [];

  const flushParticipants = () => {
    if (participantBuffer.length === 0) return;
    if (participantBuffer.length === 1) {
      const [step] = participantBuffer;
      if (step) stages.push({ kind: 'step', step });
    } else {
      stages.push({ kind: 'parallel', steps: participantBuffer });
    }
    participantBuffer = [];
  };

  trace.forEach((step) => {
    if (step.speaker === 'participant') {
      participantBuffer.push(step);
      return;
    }
    flushParticipants();
    stages.push({ kind: 'step', step });
  });

  flushParticipants();
  return stages;
}

function stageSegment(stage: TraceStage): { label: string; tone: string } {
  if (stage.kind === 'parallel') {
    return { label: `Sub-agents ${stage.steps.length}`, tone: 'text-sky-200 bg-sky-400/10 border-sky-400/20' };
  }
  return { label: routeSegmentLabel(stage.step), tone: routeSegmentTone(stage.step) };
}

function routeSegmentTone(step: TraceStep): string {
  if (step.speaker === 'participant') return 'text-sky-200 bg-sky-400/10 border-sky-400/20';
  if (step.speaker === 'router') return 'text-amber-200 bg-amber-400/10 border-amber-400/20';
  if (step.speaker === 'finalizer') return 'text-emerald-200 bg-emerald-400/10 border-emerald-400/20';
  return 'text-base-content bg-base-100/50 border-base-content/20';
}

function stepFocus(step: TraceStep): { eventId?: string; nodeId?: string } {
  return { eventId: step.eventId, nodeId: step.nodeId };
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
          <span className="ml-auto text-[10px] font-mono text-base-content/70">to {step.nextNodeId}</span>
        )}
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
  onOpenBranch,
  onOpenStep,
}: {
  step: TraceStep;
  onOpenBranch: (sessionId: string) => void;
  onOpenStep: (step: TraceStep) => void;
}) {
  const branchSessionId = step.stream?.branchSessionId;

  return (
    <button
      type="button"
      className="min-w-0 rounded-lg border border-sky-400/20 bg-sky-400/5 px-2.5 py-2 text-left transition-colors hover:border-sky-400/40 hover:bg-sky-400/10 disabled:cursor-default disabled:hover:border-sky-400/20 disabled:hover:bg-sky-400/5"
      data-testid="architecture-route-agent"
      data-session-id={branchSessionId}
      onClick={() => {
        if (branchSessionId) {
          onOpenBranch(branchSessionId);
          return;
        }
        onOpenStep(step);
      }}
    >
      <div className="flex items-center gap-2">
        <GitBranch size={12} className="text-sky-300" />
        <span className="truncate text-xs font-medium text-base-content">{nodeLabel(step)}</span>
        {step.stream && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-base-100/80 px-1 text-[9px] font-mono text-base-content/80">
            <StreamStatusIcon status={step.stream.status} warning={Boolean(step.incompleteReason)} />
            {step.incompleteReason ? 'waiting' : step.stream.status}
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-base-content/55" title={compact(step)}>
        {shortSummary(step)}
      </p>
    </button>
  );
}

function ParallelBranches({
  steps,
  onOpenBranch,
  onOpenStep,
}: {
  steps: TraceStep[];
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
          return (
          <button
            type="button"
            key={step.eventId ?? `${step.nodeId}-${step.visitIndex ?? 0}`}
            className="min-w-0 rounded-md border border-base-content/10 bg-base-300/45 px-2 py-1.5 text-left transition-colors hover:border-sky-400/40 hover:bg-sky-400/10 disabled:cursor-default disabled:hover:border-base-content/10 disabled:hover:bg-base-300/45"
            data-testid="architecture-route-agent"
            data-session-id={branchSessionId}
            onClick={() => {
              if (branchSessionId) {
                onOpenBranch(branchSessionId);
                return;
              }
              onOpenStep(step);
            }}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[11px] font-medium text-base-content">{nodeLabel(step)}</span>
              {step.stream && (
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-base-100/80 px-1 text-[9px] font-mono text-base-content/80">
                  <StreamStatusIcon status={step.stream.status} warning={Boolean(step.incompleteReason)} />
                  {step.incompleteReason ? 'waiting' : step.stream.status}
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-base-content/50" title={compact(step)}>
              {shortSummary(step, 92)}
            </p>
          </button>
          );
        })}
      </div>
    </div>
  );
}

function StreamStatusIcon({
  status,
  warning,
}: {
  status: NonNullable<ArchitectureChatRunSummary['trace'][number]['stream']>['status'];
  warning: boolean;
}) {
  if (warning) {
    return <AlertTriangle size={10} className="text-warning" />;
  }
  if (status === 'started' || status === 'streaming') {
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
}: {
  run: ArchitectureChatRunSummary;
  onOpenCanvas: () => void;
  onOpenBranch: (sessionId: string) => void;
  onOpenStep?: (focus: { eventId?: string; nodeId?: string }) => void;
}) {
  const routers = run.trace.filter((step) => step.speaker === 'router');
  const firstRouter = routers[0];
  const finalRouter = routers.at(-1);
  const hasMerge = Boolean(finalRouter && finalRouter !== firstRouter);
  const stages = buildTraceStages(run.trace);
  const shellSegments = stages.map(stageSegment);
  const openStep = (step: TraceStep) => {
    onOpenStep?.(stepFocus(step));
  };

  return (
    <div className="space-y-2 rounded-xl border border-sky-400/20 bg-base-200/45 p-2.5 shadow-sm shadow-sky-950/20" data-testid="architecture-run-timeline">
      <div className="flex items-start gap-2">
        <GitBranch size={13} className="text-sky-300" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-base-content">{run.schemaId}</p>
          <p className="text-[10px] font-mono text-base-content/75">{run.status} / {run.trace.length} graph steps</p>
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
            return <ParallelBranches key={`parallel-${index}`} steps={stage.steps} onOpenBranch={onOpenBranch} onOpenStep={openStep} />;
          }

          const { step } = stage;
            if (step.speaker === 'participant') {
              return <AgentStep key={step.eventId ?? `${step.nodeId}-${index}`} step={step} onOpenBranch={onOpenBranch} onOpenStep={openStep} />;
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
