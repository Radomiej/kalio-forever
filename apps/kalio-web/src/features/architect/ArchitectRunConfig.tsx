import { useState } from 'react';
import { AlertTriangle, BarChart3, Loader2, Play } from 'lucide-react';
import type { ArchitectExecutionMode, ArchitectSchema, PersonaOverrideMap } from './architect.types';
import type { LLMConfigWithSource } from '../settings/llm-panel.types';

interface ArchitectRunConfigProps {
  activeCredentialId: string | null;
  llmConfig: LLMConfigWithSource | null;
  maxNodeVisits: number;
  maxSteps: number;
  maxSubagentIterations: number;
  executionMode?: ArchitectExecutionMode;
  projectPath: string;
  requireGoalMasterLoopProof: boolean;
  requireImplementerWriteProof: boolean;
  autoApproveProjectWrites: boolean;
  autoApproveTerminal: boolean;
  allowOrchestratorSubagents?: boolean;
  schema: ArchitectSchema | null;
  taskPrompt: string;
  personaOverrides: PersonaOverrideMap;
  running: boolean;
  onMaxNodeVisitsChange: (value: number) => void;
  onMaxStepsChange: (value: number) => void;
  onMaxSubagentIterationsChange: (value: number) => void;
  onExecutionModeChange?: (value: ArchitectExecutionMode) => void;
  onProjectPathChange: (value: string) => void;
  onRequireGoalMasterLoopProofChange: (value: boolean) => void;
  onRequireImplementerWriteProofChange: (value: boolean) => void;
  onAutoApproveProjectWritesChange: (value: boolean) => void;
  onAutoApproveTerminalChange: (value: boolean) => void;
  onAllowOrchestratorSubagentsChange?: (value: boolean) => void;
  onTaskPromptChange: (value: string) => void;
  onStartRun: () => void;
  onStartGoalGuardFlow: () => void;
  onStopRun?: () => void;
  embedded?: boolean;
}

export function ArchitectRunConfig({
  activeCredentialId,
  llmConfig,
  maxNodeVisits,
  maxSteps,
  maxSubagentIterations,
  executionMode = 'subagent_execution',
  requireGoalMasterLoopProof,
  requireImplementerWriteProof,
  autoApproveProjectWrites,
  autoApproveTerminal,
  allowOrchestratorSubagents = false,
  projectPath,
  schema,
  taskPrompt,
  personaOverrides,
  running,
  onMaxNodeVisitsChange,
  onMaxStepsChange,
  onMaxSubagentIterationsChange,
  onExecutionModeChange,
  onRequireGoalMasterLoopProofChange,
  onRequireImplementerWriteProofChange,
  onAutoApproveProjectWritesChange,
  onAutoApproveTerminalChange,
  onAllowOrchestratorSubagentsChange,
  onProjectPathChange,
  onTaskPromptChange,
  onStartRun,
  onStartGoalGuardFlow,
  onStopRun,
  embedded = false,
}: ArchitectRunConfigProps) {
  const branchSlots = schema?.roleSlots.filter((slot) => slot.slotType === 'participant' || slot.slotType === 'critic') ?? [];
  const overrideCount = Object.keys(personaOverrides).length;
  const routingNodes = schema?.nodes.filter((node) => node.kind === 'parallel' || node.kind === 'router').length ?? 0;
  const credentialWarning = runtimeCredentialWarning(llmConfig, activeCredentialId);
  const budget = schema ? estimateArchitectureBudget(schema, maxSteps, maxNodeVisits, maxSubagentIterations) : null;
  const [showRunAudit, setShowRunAudit] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runMode, setRunMode] = useState<'standard' | 'goalGuard'>('standard');
  const useVfsSandbox = !projectPath.trim() && !autoApproveProjectWrites && !autoApproveTerminal;
  const canStartStandardRun = Boolean(schema) && !running && taskPrompt.trim().length > 0;
  const canStartGoalGuard = !running && taskPrompt.trim().length > 0;

  const setSandboxMode = (mode: 'vfs' | 'realProject') => {
    if (mode === 'vfs') {
      onProjectPathChange('');
      onAutoApproveProjectWritesChange(false);
      onAutoApproveTerminalChange(false);
    } else if (!projectPath.trim()) {
      onProjectPathChange('C:\\Projekty\\TurboProject2');
    }
  };

  return (
    <section className={embedded ? 'relative min-w-0 flex-1 bg-base-100/95' : 'relative shrink-0 border-b border-base-300 bg-base-100/95'} data-testid="architect-run-config">
      {credentialWarning && (
        <div className="flex min-h-8 items-center gap-2 border-b border-warning/20 bg-warning/10 px-3 py-1.5 text-[11px] text-warning-content" data-testid="architect-provider-warning">
          <span className="badge badge-warning badge-xs uppercase">provider</span>
          <span className="min-w-0 truncate">{credentialWarning}</span>
        </div>
      )}
      <div className={embedded ? 'flex min-h-9 min-w-0 items-center justify-end gap-2 px-1 py-1' : 'flex min-h-11 flex-wrap items-center justify-end gap-1.5 px-3 py-1.5'}>

        <button
          type="button"
          className={`btn btn-sm min-h-11 shrink-0 gap-1.5 px-3 text-xs ${showRunAudit ? 'btn-info' : 'btn-ghost border border-base-300 bg-base-200/60'}`}
          onClick={() => setShowRunAudit((value) => !value)}
          data-testid="architect-run-audit-toggle"
          aria-expanded={showRunAudit}
        >
          <BarChart3 size={13} />
          Run audit
          {budget ? <span className={`badge badge-xs ${budget.tone === 'danger' ? 'badge-error' : budget.tone === 'warning' ? 'badge-warning' : 'badge-info'}`}>{budget.label}</span> : null}
        </button>

        <button
          type="button"
          className="btn btn-primary btn-sm min-h-11 shrink-0 gap-1.5 px-4 text-xs"
          onClick={() => setShowRunModal(true)}
          disabled={running || !taskPrompt.trim()}
          data-testid="architect-run-modal-open"
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          Run
        </button>
        {running && onStopRun && (
          <button
            type="button"
            className="btn btn-error btn-sm min-h-11 shrink-0 gap-1.5 px-3 text-xs"
            onClick={onStopRun}
            data-testid="architect-stop-run"
          >
            Stop
          </button>
        )}
      </div>
      {showRunAudit && (
        <div
          className="absolute right-0 top-[calc(100%+0.25rem)] z-50 grid w-[min(56rem,calc(100vw-6rem))] gap-2 rounded-lg border border-base-300/80 bg-base-100/98 px-3 py-2 text-xs text-base-content/75 shadow-2xl backdrop-blur lg:grid-cols-[auto_1fr]"
          data-testid="architect-run-audit-panel"
        >
          <div className="flex flex-wrap items-center gap-1 text-center">
            <RunMetric label="roles" value={String(schema?.roleSlots.length ?? 0)} />
            <RunMetric label="branch actors" value={String(branchSlots.length)} />
            {budget && <RunMetric label="runtime actors" value={String(budget.executableSlots)} />}
            <RunMetric label="routing nodes" value={String(routingNodes)} />
            <RunMetric label="persona overrides" value={String(overrideCount)} />
            {budget && <RunMetric label="risk" value={budget.label} tone={budget.tone} />}
          </div>
          <div className="min-w-0 space-y-1 leading-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="font-semibold text-base-content">Runtime fan-out estimate, not visible canvas edges.</p>
              {budget && <AuditFact label="Formula" value={`${budget.estimatedCalls} node executions x ${maxSubagentIterations} iters = ~${budget.estimatedLlmTurns} turns`} testId="architect-run-audit-formula" />}
              <AuditFact label="Cap" value={`${maxSteps} steps, ${maxNodeVisits} visits, ${maxSubagentIterations} iters`} />
            </div>
            {budget && <p className="text-[11px] text-base-content/60">{budget.shortDescription}</p>}
            <details className="rounded-md border border-base-300/70 bg-base-100/45 px-2 py-1" data-testid="architect-run-audit-details">
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-base-content/55">Metric definitions</summary>
              <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                <AuditFact label="Roles" value="all configured role slots in the schema" />
                <AuditFact label="Branch actors" value="participant/critic slots that can produce parallel branch outputs" />
                <AuditFact label="Runtime actors" value="branch actors plus router, judge and finalizer slots that may execute" />
                <AuditFact label="Routing nodes" value="parallel/router nodes that can fan out, rank or merge paths" />
                <AuditFact label="Risk" value="derived from estimated LLM/tool-loop turns and runtime actor count" />
                <AuditFact label="Why repeated" value={`each runtime actor can be revisited up to ${maxNodeVisits} times, then each visit can run up to ${maxSubagentIterations} agent iterations`} testId="architect-run-audit-repetition" />
                <AuditFact label="Step cap" value={`node executions are capped by max steps (${maxSteps}), so the estimate is an upper bound, not a promise`} />
                {budget && <AuditFact label="Risk text" value={budget.description} />}
              </div>
            </details>
          </div>
        </div>
      )}
      <div className={showRunModal ? 'modal modal-open items-start pt-14' : 'hidden'} data-testid="architect-run-modal">
        <div className="modal-box max-w-3xl rounded-lg border border-base-300 bg-base-100 p-0">
          <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
            <div>
              <h3 className="text-base font-bold text-base-content">Run configuration</h3>
              <p className="text-xs text-base-content/65">Choose runtime mode, sandbox scope and execution guards before starting.</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowRunModal(false)}
              data-testid="architect-run-modal-close"
            >
              Close
            </button>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div className="rounded-md border border-base-300 bg-base-200/45 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-base-content/65">Flow</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`btn btn-sm ${runMode === 'standard' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                  onClick={() => setRunMode('standard')}
                  data-testid="architect-run-mode-standard"
                >
                  Run
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${runMode === 'goalGuard' ? 'btn-secondary' : 'btn-ghost border border-base-300'}`}
                  aria-label="Select guarded run mode"
                  onClick={() => setRunMode('goalGuard')}
                  data-testid="architect-run-mode-goal-guard"
                >
                  Goal Guard
                </button>
              </div>
            </div>

            <div className="rounded-md border border-base-300 bg-base-200/45 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-base-content/65">Execution mode</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`btn btn-sm ${executionMode === 'subagent_execution' ? 'btn-info' : 'btn-ghost border border-base-300'}`}
                  onClick={() => onExecutionModeChange?.('subagent_execution')}
                  disabled={!onExecutionModeChange}
                  data-testid="architect-execution-mode-subagent"
                >
                  Subagents
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${executionMode === 'session_branches' ? 'btn-info' : 'btn-ghost border border-base-300'}`}
                  onClick={() => onExecutionModeChange?.('session_branches')}
                  disabled={!onExecutionModeChange}
                  data-testid="architect-execution-mode-session-branches"
                >
                  Session branches
                </button>
              </div>
            </div>

            <div className="rounded-md border border-base-300 bg-base-200/45 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-base-content/65">Project scope</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`btn btn-sm ${useVfsSandbox ? 'btn-info' : 'btn-ghost border border-base-300'}`}
                  onClick={() => setSandboxMode('vfs')}
                  data-testid="architect-vfs-sandbox"
                >
                  VFS sandbox
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${useVfsSandbox ? 'btn-ghost border border-base-300' : 'btn-info'}`}
                  onClick={() => setSandboxMode('realProject')}
                  data-testid="architect-real-project"
                >
                  Real project
                </button>
              </div>
            </div>

            <label className="lg:col-span-2 rounded-md border border-base-300 bg-base-200/45 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wide text-base-content/65">Task</span>
              <textarea
                className="mt-2 textarea textarea-bordered min-h-24 w-full resize-none text-sm leading-6"
                value={taskPrompt}
                onChange={(event) => onTaskPromptChange(event.target.value)}
                placeholder="Task for this architecture run..."
                data-testid="architect-task-input"
                aria-label="Task"
              />
            </label>

            <label className="lg:col-span-2 rounded-md border border-base-300 bg-base-200/45 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wide text-base-content/65">Project path</span>
              <input
                className="mt-2 input input-bordered input-sm w-full font-mono text-xs"
                value={projectPath}
                onChange={(event) => onProjectPathChange(event.target.value)}
                placeholder="Leave empty for VFS sandbox"
                data-testid="architect-project-path"
              />
            </label>

            <div className="rounded-md border border-base-300 bg-base-200/45 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-base-content/65">Limits</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <NumberField label="steps" value={maxSteps} min={1} max={256} onChange={onMaxStepsChange} testId="architect-max-steps" />
                <NumberField label="visits" value={maxNodeVisits} min={1} max={32} onChange={onMaxNodeVisitsChange} testId="architect-max-node-visits" />
                <NumberField label="iters" value={maxSubagentIterations} min={1} max={10} onChange={onMaxSubagentIterationsChange} testId="architect-max-subagent-iterations" />
              </div>
              {budget && budget.tone !== 'ok' && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning-content" data-testid="architect-token-budget-warning">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{budget.shortDescription}</span>
                </div>
              )}
            </div>

            <div className="rounded-md border border-base-300 bg-base-200/45 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-base-content/65">Proof and writes</p>
              <div className="mt-2 grid gap-2 text-xs">
                <ToggleField label="Goal proof" checked={requireGoalMasterLoopProof} onChange={onRequireGoalMasterLoopProofChange} testId="architect-goal-master-loop-proof" />
                <ToggleField label="Implementer write" checked={requireImplementerWriteProof} onChange={onRequireImplementerWriteProofChange} testId="architect-implementer-write-proof" />
                <ToggleField label="Project writes" checked={autoApproveProjectWrites} onChange={onAutoApproveProjectWritesChange} testId="architect-auto-approve-project-writes" />
                <ToggleField label="Terminal" checked={autoApproveTerminal} onChange={onAutoApproveTerminalChange} testId="architect-auto-approve-terminal" />
                <ToggleField label="Subagents" checked={allowOrchestratorSubagents} onChange={(value) => onAllowOrchestratorSubagentsChange?.(value)} testId="architect-allow-orchestrator-subagents" disabled={!onAllowOrchestratorSubagentsChange} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-base-300 px-4 py-3">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowRunModal(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm gap-2"
              onClick={() => {
                onStartRun();
                setShowRunModal(false);
              }}
              disabled={!canStartStandardRun}
              data-testid="architect-start-run"
            >
              <Play size={14} />
              Start run
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm gap-2"
              onClick={() => {
                onStartGoalGuardFlow();
                setShowRunModal(false);
              }}
              disabled={!canStartGoalGuard}
              data-testid="architect-start-goal-guard-flow"
            >
              Goal Guard
            </button>
          </div>
        </div>
        <div className="modal-backdrop" onClick={() => setShowRunModal(false)} />
      </div>
    </section>
  );
}

export function runtimeCredentialWarning(
  llmConfig: LLMConfigWithSource | null,
  activeCredentialId: string | null,
): string | null {
  if (!llmConfig) {
    return 'Real subagent runs need a reachable LLM provider. Runtime config is still loading.';
  }
  if (llmConfig.source === 'env' || !activeCredentialId) {
    const provider = llmConfig.provider || 'env provider';
    const model = llmConfig.model || 'no model selected';
    return `Real subagent runs use ${provider} / ${model} from env fallback; no saved credential is active. Provider auth failures will stop the architecture run.`;
  }
  return null;
}

export function estimateArchitectureBudget(
  schema: ArchitectSchema,
  maxSteps: number,
  maxNodeVisits: number,
  maxSubagentIterations = 4,
): {
  label: string;
  tone: 'ok' | 'warning' | 'danger';
  shortDescription: string;
  description: string;
  executableSlots: number;
  branchSlots: number;
  parallelNodes: number;
  loopEdges: number;
  estimatedCalls: number;
  estimatedLlmTurns: number;
} {
  const branchSlots = schema.roleSlots.filter((slot) => slot.slotType === 'participant' || slot.slotType === 'critic').length;
  const executableSlots = schema.roleSlots.filter((slot) => (
    slot.slotType === 'participant'
    || slot.slotType === 'critic'
    || slot.slotType === 'router'
    || slot.slotType === 'judge'
    || slot.slotType === 'finalizer'
  )).length;
  const parallelNodes = schema.nodes.filter((node) => node.kind === 'parallel').length;
  const loopEdges = schema.edges.filter((edge) => {
    const from = schema.nodes.find((node) => node.id === edge.fromNodeId);
    const to = schema.nodes.find((node) => node.id === edge.toNodeId);
    return from?.y !== undefined && to?.y !== undefined && to.y <= from.y;
  }).length;
  const estimatedCalls = Math.min(maxSteps, Math.max(1, executableSlots + parallelNodes + loopEdges) * Math.max(1, maxNodeVisits));
  const estimatedLlmTurns = estimatedCalls * Math.max(1, maxSubagentIterations);
  if (estimatedLlmTurns >= 180 || executableSlots >= 16) {
    return {
      label: 'high',
      tone: 'danger',
      shortDescription: `high budget ~${estimatedLlmTurns} turns`,
      description: `High-cost architecture: ${executableSlots} executable slots, ${parallelNodes} parallel nodes, ${loopEdges} loop edges, up to about ${estimatedCalls} node executions and ${estimatedLlmTurns} LLM/tool-loop turns from current guards.`,
      executableSlots,
      branchSlots,
      parallelNodes,
      loopEdges,
      estimatedCalls,
      estimatedLlmTurns,
    };
  }
  if (estimatedLlmTurns >= 72 || executableSlots >= 9) {
    return {
      label: 'med',
      tone: 'warning',
      shortDescription: `medium budget ~${estimatedLlmTurns} turns`,
      description: `Medium-cost architecture: ${executableSlots} executable slots, ${parallelNodes} parallel nodes, ${loopEdges} loop edges, up to about ${estimatedCalls} node executions and ${estimatedLlmTurns} LLM/tool-loop turns from current guards.`,
      executableSlots,
      branchSlots,
      parallelNodes,
      loopEdges,
      estimatedCalls,
      estimatedLlmTurns,
    };
  }
  return {
    label: 'low',
    tone: 'ok',
    shortDescription: `low budget ~${estimatedLlmTurns} turns`,
    description: `Low-cost architecture: up to about ${estimatedCalls} node executions and ${estimatedLlmTurns} LLM/tool-loop turns from current guards.`,
    executableSlots,
    branchSlots,
    parallelNodes,
    loopEdges,
    estimatedCalls,
    estimatedLlmTurns,
  };
}

function AuditFact({ label, testId, value }: { label: string; testId?: string; value: string }) {
  return (
    <p className="min-w-0" data-testid={testId}>
      <span className="font-semibold text-base-content">{label}</span>
      <span className="text-base-content/55"> = </span>
      <span>{value}</span>
    </p>
  );
}

function NumberField({
  label,
  min,
  max,
  onChange,
  testId,
  value,
}: {
  label: string;
  min: number;
  max?: number;
  onChange: (value: number) => void;
  testId: string;
  value: number;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1 rounded-md border border-base-300 bg-base-100/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-base-content/65">
      {label}
      <input
        className="h-6 w-12 rounded border border-base-300 bg-base-100 px-1.5 text-xs font-semibold text-base-content outline-none"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          if (Number.isFinite(parsed) && parsed >= min && (max === undefined || parsed <= max)) {
            onChange(parsed);
          }
        }}
        data-testid={testId}
      />
    </label>
  );
}

function ToggleField({
  checked,
  disabled = false,
  label,
  onChange,
  testId,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
  testId: string;
}) {
  return (
    <label className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-base-300 bg-base-100/70 px-2 py-1.5" data-testid={testId}>
      <span className="font-semibold text-base-content/75">{label}</span>
      <input
        type="checkbox"
        className="toggle toggle-info min-h-11 min-w-14"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function RunMetric({ label, tone = 'ok', value }: { label: string; tone?: 'ok' | 'warning' | 'danger'; value: string }) {
  return (
    <div className={`min-w-12 rounded-md border px-2 py-1 ${
      tone === 'danger'
        ? 'border-error/40 bg-error/10'
        : tone === 'warning'
          ? 'border-warning/40 bg-warning/10'
          : 'border-base-300 bg-base-100/60'
    }`}>
      <div className="text-[11px] font-semibold text-base-content">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-base-content/60">{label}</div>
    </div>
  );
}
