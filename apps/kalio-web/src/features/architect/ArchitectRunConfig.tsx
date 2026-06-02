import { AlertTriangle, Loader2, Play, Route } from 'lucide-react';
import type { ArchitectSchema, PersonaOverrideMap } from './architect.types';
import type { LLMConfigWithSource } from '../settings/llm-panel.types';

interface ArchitectRunConfigProps {
  activeCredentialId: string | null;
  llmConfig: LLMConfigWithSource | null;
  maxNodeVisits: number;
  maxSteps: number;
  maxSubagentIterations: number;
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
}

export function ArchitectRunConfig({
  activeCredentialId,
  llmConfig,
  maxNodeVisits,
  maxSteps,
  maxSubagentIterations,
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
}: ArchitectRunConfigProps) {
  const executableSlots = schema?.roleSlots.filter((slot) => slot.slotType === 'participant' || slot.slotType === 'critic') ?? [];
  const overrideCount = Object.keys(personaOverrides).length;
  const behaviorNodes = schema?.nodes.filter((node) => node.kind === 'parallel' || node.kind === 'router').length ?? 0;
  const credentialWarning = runtimeCredentialWarning(llmConfig, activeCredentialId);
  const budget = schema ? estimateArchitectureBudget(schema, maxSteps, maxNodeVisits, maxSubagentIterations) : null;

  return (
    <section className="shrink-0 border-b border-base-300 bg-base-100/95" data-testid="architect-run-config">
      {credentialWarning && (
        <div className="flex min-h-8 items-center gap-2 border-b border-warning/20 bg-warning/10 px-3 py-1.5 text-[11px] text-warning-content" data-testid="architect-provider-warning">
          <span className="badge badge-warning badge-xs uppercase">provider</span>
          <span className="min-w-0 truncate">{credentialWarning}</span>
        </div>
      )}
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 px-3 py-1.5">
        <label className="flex min-w-[18rem] flex-[1_1_24rem] items-center gap-2 rounded-md border border-base-300 bg-base-200/60 px-2.5 py-1">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-base-content/45">Task</span>
          <input
            className="h-6 min-w-0 flex-1 bg-transparent text-[13px] text-base-content outline-none"
            value={taskPrompt}
            onChange={(event) => onTaskPromptChange(event.target.value)}
            placeholder="Task for this architecture run"
            data-testid="architect-task-input"
          />
        </label>

        <div className="hidden shrink-0 items-center gap-1.5 rounded-md border border-base-300 bg-base-200/60 px-2 py-1 text-[11px] text-base-content/60 xl:flex">
          <Route size={12} className="text-sky-300" />
          <span data-testid="architect-routing-model">Node-level routing</span>
        </div>

        <NumberField
          label="steps"
          value={maxSteps}
          min={1}
          testId="architect-max-steps"
          onChange={onMaxStepsChange}
        />
        <NumberField
          label="visits"
          value={maxNodeVisits}
          min={1}
          testId="architect-max-node-visits"
          onChange={onMaxNodeVisitsChange}
        />
        <NumberField
          label="iters"
          value={maxSubagentIterations}
          min={1}
          max={10}
          testId="architect-max-subagent-iterations"
          onChange={onMaxSubagentIterationsChange}
        />

        <label
          className={`hidden shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide xl:flex ${
            requireGoalMasterLoopProof
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-base-300 bg-base-200/60 text-base-content/45'
          }`}
          title="Require judge/Goal Master routers to prove at least one visible continuation before finalizing."
        >
          <input
            type="checkbox"
            className="checkbox checkbox-warning h-6 w-6"
            checked={requireGoalMasterLoopProof}
            onChange={(event) => onRequireGoalMasterLoopProofChange(event.target.checked)}
            data-testid="architect-goal-master-loop-proof"
          />
          goal proof
        </label>

        <label
          className={`hidden shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide xl:flex ${
            requireImplementerWriteProof
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-base-300 bg-base-200/60 text-base-content/45'
          }`}
          title="Require the Implementer role itself to produce visible write evidence before Goal Guard can accept."
        >
          <input
            type="checkbox"
            className="checkbox checkbox-warning h-6 w-6"
            checked={requireImplementerWriteProof}
            onChange={(event) => onRequireImplementerWriteProofChange(event.target.checked)}
            data-testid="architect-implementer-write-proof"
          />
          impl write
        </label>

        <label className="hidden min-w-[14rem] max-w-[24rem] shrink grow items-center gap-1.5 rounded-md border border-base-300 bg-base-200/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-base-content/45 2xl:flex">
          workdir
          <input
            className="h-6 min-w-0 flex-1 bg-transparent text-[12px] normal-case tracking-normal text-base-content outline-none"
            value={projectPath}
            onChange={(event) => onProjectPathChange(event.target.value)}
            placeholder="VFS only unless host path is set"
            data-testid="architect-project-path"
          />
        </label>

        <label
          className={`hidden shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide xl:flex ${
            autoApproveProjectWrites
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-base-300 bg-base-200/60 text-base-content/45'
          }`}
          title="Allow architecture implementer nodes to write to the configured host project path."
        >
          <input
            type="checkbox"
            className="checkbox checkbox-warning h-6 w-6"
            checked={autoApproveProjectWrites}
            onChange={(event) => onAutoApproveProjectWritesChange(event.target.checked)}
            data-testid="architect-auto-approve-project-writes"
          />
          writes
        </label>

        <label
          className={`hidden shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide xl:flex ${
            autoApproveTerminal
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-base-300 bg-base-200/60 text-base-content/45'
          }`}
          title="Allow architecture verifier nodes to run terminal checks in the configured host project path."
        >
          <input
            type="checkbox"
            className="checkbox checkbox-warning h-6 w-6"
            checked={autoApproveTerminal}
            onChange={(event) => onAutoApproveTerminalChange(event.target.checked)}
            data-testid="architect-auto-approve-terminal"
          />
          terminal
        </label>

        <label
          className={`hidden shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide xl:flex ${
            allowOrchestratorSubagents
              ? 'border-sky-400/40 bg-sky-500/10 text-sky-200'
              : 'border-base-300 bg-base-200/60 text-base-content/45'
          }`}
          title="Allow the Orchestrator node to call run_subagent/spawn_subagent. Off keeps execution inside the architecture graph via route_to(...)."
        >
          <input
            type="checkbox"
            className="checkbox checkbox-info h-6 w-6"
            checked={allowOrchestratorSubagents}
            onChange={(event) => onAllowOrchestratorSubagentsChange?.(event.target.checked)}
            data-testid="architect-allow-orchestrator-subagents"
          />
          subagents
        </label>

        <div className="hidden shrink-0 items-center gap-1 text-center lg:flex">
          <RunMetric label="roles" value={String(schema?.roleSlots.length ?? 0)} />
          <RunMetric label="branches" value={String(executableSlots.length)} />
          <RunMetric label="routers" value={String(behaviorNodes)} />
          <RunMetric label="overrides" value={String(overrideCount)} />
          {budget && <RunMetric label="risk" value={budget.label} tone={budget.tone} />}
        </div>

        {budget?.tone === 'warning' || budget?.tone === 'danger' ? (
          <div
            className={`hidden max-w-56 shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide 2xl:flex ${
              budget.tone === 'danger'
                ? 'border-error/40 bg-error/10 text-error'
                : 'border-warning/40 bg-warning/10 text-warning'
            }`}
            data-testid="architect-token-budget-warning"
            title={budget.description}
          >
            <AlertTriangle size={12} />
            <span className="truncate">{budget.shortDescription}</span>
          </div>
        ) : null}

        <button
          type="button"
          className="btn btn-primary btn-sm min-h-8 shrink-0 gap-1.5 px-3 text-xs"
          onClick={onStartRun}
          disabled={!schema || running || !taskPrompt.trim()}
          data-testid="architect-start-run"
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          Start run
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm min-h-8 shrink-0 gap-1.5 px-3 text-xs"
          onClick={onStartGoalGuardFlow}
          disabled={running || !taskPrompt.trim()}
          data-testid="architect-start-goal-guard-flow"
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          Goal Guard
        </button>
        {running && onStopRun && (
          <button
            type="button"
            className="btn btn-error btn-sm min-h-8 shrink-0 gap-1.5 px-3 text-xs"
            onClick={onStopRun}
            data-testid="architect-stop-run"
          >
            Stop
          </button>
        )}
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
): { label: string; tone: 'ok' | 'warning' | 'danger'; shortDescription: string; description: string } {
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
    };
  }
  if (estimatedLlmTurns >= 72 || executableSlots >= 9) {
    return {
      label: 'med',
      tone: 'warning',
      shortDescription: `medium budget ~${estimatedLlmTurns} turns`,
      description: `Medium-cost architecture: ${executableSlots} executable slots, ${parallelNodes} parallel nodes, ${loopEdges} loop edges, up to about ${estimatedCalls} node executions and ${estimatedLlmTurns} LLM/tool-loop turns from current guards.`,
    };
  }
  return {
    label: 'low',
    tone: 'ok',
    shortDescription: `low budget ~${estimatedLlmTurns} turns`,
    description: `Low-cost architecture: up to about ${estimatedCalls} node executions and ${estimatedLlmTurns} LLM/tool-loop turns from current guards.`,
  };
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
    <label className="hidden shrink-0 items-center gap-1 rounded-md border border-base-300 bg-base-200/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-base-content/45 xl:flex">
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
      <div className="text-[9px] uppercase tracking-wide text-base-content/40">{label}</div>
    </div>
  );
}
