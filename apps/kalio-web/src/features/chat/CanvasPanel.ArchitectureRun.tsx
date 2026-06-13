import { GitBranch, Route, ShieldCheck } from 'lucide-react';
import type { ArchitectureChatRunSummary, ChatMessage, ChatSession } from '@kalio/types';
import { compactArchitectureTraceContent } from './architectureChatSummary';

type TraceStep = ArchitectureChatRunSummary['trace'][number];
type ArchitectureRunFocusedStep = { eventId?: string; nodeId?: string };
type TraceStage =
  | { kind: 'step'; step: TraceStep }
  | { kind: 'parallel'; steps: TraceStep[] };

function isFocusedTraceStep(step: TraceStep, focusedStep: ArchitectureRunFocusedStep | undefined): boolean {
  if (!focusedStep) {
    return false;
  }
  if (focusedStep.eventId && step.eventId === focusedStep.eventId) {
    return true;
  }
  return Boolean(focusedStep.nodeId && step.nodeId === focusedStep.nodeId);
}

function roleLabel(step: TraceStep): string {
  if (step.nodeId) {
    return step.nodeId
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
      .join(' ');
  }
  if (step.speaker === 'router') return 'Router';
  if (step.speaker === 'finalizer') return 'Finalizer';
  return 'Agent';
}

function compact(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function findSessionTitle(sessions: ChatSession[], sessionId: string): string {
  return sessions.find((session) => session.id === sessionId)?.title ?? sessionId;
}

function hasBranchSession(sessions: ChatSession[], sessionId: string | undefined): sessionId is string {
  return typeof sessionId === 'string' && sessions.some((session) => session.id === sessionId);
}

function visibleTranscript(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-3);
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

function stageLabel(stage: TraceStage): string {
  if (stage.kind === 'parallel') return 'Sub-agents';
  if (stage.step.speaker === 'router') return 'Router';
  if (stage.step.speaker === 'finalizer') return 'Finalizer';
  return roleLabel(stage.step);
}

function ArchitectureTraceCard({
  step,
  sessions,
  onOpenSession,
  label,
  transcript = [],
  focused = false,
}: {
  step: TraceStep;
  sessions: ChatSession[];
  onOpenSession: (sessionId: string) => void;
  label?: string;
  transcript?: ChatMessage[];
  focused?: boolean;
}) {
  const branchSessionId = step.stream?.branchSessionId;
  const openableBranchSessionId = hasBranchSession(sessions, branchSessionId) ? branchSessionId : undefined;
  const visibleMessages = visibleTranscript(transcript);
  const tone = step.speaker === 'participant'
    ? 'border-sky-500/20 bg-sky-500/5'
    : step.speaker === 'router'
      ? 'border-amber-500/20 bg-amber-500/5'
      : 'border-emerald-500/20 bg-emerald-500/5';

  return (
    <div
      className={`rounded-xl border px-3 py-2 text-xs space-y-2 ${tone} ${focused ? 'ring-1 ring-sky-300/70 shadow-[0_0_0_1px_rgba(125,211,252,0.26)]' : ''}`}
      data-testid={`architecture-run-step-${step.eventId ?? roleLabel(step)}`}
      data-focused-step={focused ? 'true' : 'false'}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 rounded-md border border-base-content/10 bg-base-200/60 p-1">
          {step.speaker === 'participant' ? <GitBranch size={11} /> : <Route size={11} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-base-content truncate">{label ?? roleLabel(step)}</p>
          <p className="text-[10px] uppercase tracking-wide text-base-content/40">
            {step.speaker}
            {step.nextNodeId ? ` -> ${step.nextNodeId}` : ''}
          </p>
        </div>
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
  steps,
  sessions,
  onOpenSession,
  getBranchMessages,
  focusedStep,
}: {
  steps: TraceStep[];
  sessions: ChatSession[];
  onOpenSession: (sessionId: string) => void;
  getBranchMessages: (sessionId: string) => ChatMessage[];
  focusedStep?: ArchitectureRunFocusedStep;
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
          <ArchitectureTraceCard
            key={step.eventId ?? `${step.nodeId}-${step.visitIndex ?? 0}`}
            step={step}
            sessions={sessions}
            onOpenSession={onOpenSession}
            transcript={step.stream?.branchSessionId ? getBranchMessages(step.stream.branchSessionId) : []}
            focused={isFocusedTraceStep(step, focusedStep)}
          />
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
  stages,
  sessions,
  onOpenSession,
  getBranchMessages,
  focusedStep,
}: {
  stages: TraceStage[];
  sessions: ChatSession[];
  onOpenSession: (sessionId: string) => void;
  getBranchMessages: (sessionId: string) => ChatMessage[];
  focusedStep?: ArchitectureRunFocusedStep;
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
              steps={stage.steps}
              sessions={sessions}
              onOpenSession={onOpenSession}
              getBranchMessages={getBranchMessages}
              focusedStep={focusedStep}
            />
          ) : (
            <ArchitectureTraceCard
              step={stage.step}
              sessions={sessions}
              onOpenSession={onOpenSession}
              label={stage.step.speaker === 'finalizer' ? 'Finalizer' : undefined}
              transcript={stage.step.stream?.branchSessionId ? getBranchMessages(stage.step.stream.branchSessionId) : []}
              focused={isFocusedTraceStep(stage.step, focusedStep)}
            />
          )}
          {index < stages.length - 1 && <ArchitectureFlowSeparator />}
        </div>
      ))}
    </div>
  );
}

function ArchitectureTranscriptEntry({
  step,
  sessions,
  getBranchMessages,
}: {
  step: TraceStep;
  sessions: ChatSession[];
  getBranchMessages: (sessionId: string) => ChatMessage[];
}) {
  const branchSessionId = step.stream?.branchSessionId;
  const openableBranchSessionId = hasBranchSession(sessions, branchSessionId) ? branchSessionId : undefined;
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
        <p className="font-medium text-base-content">{roleLabel(step)}</p>
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
}: {
  run: ArchitectureChatRunSummary;
  sessions: ChatSession[];
  onOpenSession: (sessionId: string) => void;
  getBranchMessages: (sessionId: string) => ChatMessage[];
  focused?: boolean;
  focusedStep?: ArchitectureRunFocusedStep;
}) {
  const stages = buildTraceStages(run.trace);
  const routeText = stages.map(stageLabel).join(' -> ');

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
        <p className="text-base-content/45 font-mono">{run.status} / {run.trace.length} steps</p>
      </div>

      <div className="space-y-1.5" data-testid="architecture-run-flow">
        <ArchitectureSequentialFlow
          stages={stages}
          sessions={sessions}
          onOpenSession={onOpenSession}
          getBranchMessages={getBranchMessages}
          focusedStep={focusedStep}
        />
        <div className="hidden" data-testid="architecture-run-routing">{routeText}</div>
      </div>

      <div className="mt-3 space-y-1.5" data-testid="architecture-run-internal-transcript">
        <p className="text-[10px] uppercase tracking-wide text-base-content/40">Internal transcript</p>
        {run.trace.map((step, index) => (
          <ArchitectureTranscriptEntry
            key={step.eventId ?? `${step.speaker}-${step.nodeId ?? index}-${step.visitIndex ?? 0}`}
            step={step}
            sessions={sessions}
            getBranchMessages={getBranchMessages}
          />
        ))}
      </div>
    </section>
  );
}
