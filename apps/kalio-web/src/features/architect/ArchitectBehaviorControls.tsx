import type { ArchitectureNodeBehaviorMode, ArchitectureNodeFanOutMode, ArchitectureNodeScoringPolicy } from '@kalio/types';
import type { ArchitectNode, ArchitectSchema } from './architect.types';

interface ArchitectBehaviorControlsProps {
  node: ArchitectNode;
  schema: ArchitectSchema | null;
  onChange: (nodeId: string, behavior: NonNullable<ArchitectNode['behavior']>) => void;
}

const BEHAVIOR_MODES: ReadonlyArray<{ value: ArchitectureNodeBehaviorMode; label: string }> = [
  { value: 'fan_out_all', label: 'Run all outgoing' },
  { value: 'choose_one', label: 'Choose one path' },
  { value: 'rank_then_merge', label: 'Rank then merge' },
  { value: 'merge_inputs', label: 'Merge inputs' },
  { value: 'finalize', label: 'Finalize' },
];

const FAN_OUT_MODES: ReadonlyArray<{ value: ArchitectureNodeFanOutMode; label: string }> = [
  { value: 'parallel', label: 'Parallel' },
  { value: 'sequential', label: 'Sequential' },
];

const SCORING_POLICIES: ReadonlyArray<{ value: ArchitectureNodeScoringPolicy; label: string }> = [
  { value: 'confidence', label: 'Confidence' },
  { value: 'risk', label: 'Risk' },
  { value: 'cost', label: 'Cost' },
  { value: 'custom', label: 'Custom' },
];

export function ArchitectBehaviorControls({ node, schema, onChange }: ArchitectBehaviorControlsProps) {
  const behavior = node.behavior ?? defaultBehaviorForKind(node.kind);
  const targetNodes = schema?.nodes.filter((candidate) => candidate.id !== node.id) ?? [];
  const showSelection = behavior.mode === 'choose_one' || behavior.mode === 'rank_then_merge';

  const update = (patch: Partial<NonNullable<ArchitectNode['behavior']>>) => {
    onChange(node.id, { ...behavior, ...patch });
  };

  const updateMode = (mode: ArchitectureNodeBehaviorMode) => {
    const next: NonNullable<ArchitectNode['behavior']> = { ...behavior, mode };
    if (mode === 'choose_one' || mode === 'rank_then_merge') {
      next.maxBranches = next.maxBranches ?? 1;
      next.scoringPolicy = next.scoringPolicy ?? 'confidence';
    }
    onChange(node.id, next);
  };

  return (
    <section className="mt-4 rounded-md border border-sky-500/25 bg-sky-500/10 p-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-sky-300">Node routing</div>
      <div className="mt-2 form-control gap-1">
        <label className="label-text text-xs font-semibold text-base-content/70">Strategy</label>
        <select
          aria-label="Node routing strategy"
          className="select select-bordered select-sm h-9 min-h-9 w-full"
          value={behavior.mode}
          onChange={(event) => updateMode(event.target.value as ArchitectureNodeBehaviorMode)}
          data-testid="architect-node-behavior-mode"
        >
          {BEHAVIOR_MODES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="form-control gap-1">
          <label className="label-text text-xs font-semibold text-base-content/70">Fan-out</label>
          <select
            aria-label="Node fan-out mode"
            className="select select-bordered select-sm h-9 min-h-9 w-full"
            value={behavior.fanOut ?? 'parallel'}
            onChange={(event) => update({ fanOut: event.target.value as ArchitectureNodeFanOutMode })}
            data-testid="architect-node-fanout-mode"
          >
            {FAN_OUT_MODES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        {showSelection && (
          <div className="form-control gap-1">
            <label className="label-text text-xs font-semibold text-base-content/70">Max paths</label>
            <input
              className="input input-bordered input-sm h-9"
              type="number"
              min={1}
              value={behavior.maxBranches ?? 1}
              onChange={(event) => update({ maxBranches: Number.parseInt(event.target.value, 10) || 1 })}
              data-testid="architect-node-max-branches"
            />
          </div>
        )}
      </div>

      {showSelection && (
        <div className="mt-2 form-control gap-1">
          <label className="label-text text-xs font-semibold text-base-content/70">Scoring</label>
          <select
            aria-label="Node scoring policy"
            className="select select-bordered select-sm h-9 min-h-9 w-full"
            value={behavior.scoringPolicy ?? 'confidence'}
            onChange={(event) => update({ scoringPolicy: event.target.value as ArchitectureNodeScoringPolicy })}
            data-testid="architect-node-scoring-policy"
          >
            {SCORING_POLICIES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-2 form-control gap-1">
        <label className="label-text text-xs font-semibold text-base-content/70">Converges to</label>
        <select
          aria-label="Node converge target"
          className="select select-bordered select-sm h-9 min-h-9 w-full"
          value={behavior.convergeToNodeId ?? ''}
          onChange={(event) => update({ convergeToNodeId: event.target.value || undefined })}
          data-testid="architect-node-converge-target"
        >
          <option value="">Use outgoing edges</option>
          {targetNodes.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
          ))}
        </select>
      </div>
    </section>
  );
}

function defaultBehaviorForKind(kind: ArchitectNode['kind']): NonNullable<ArchitectNode['behavior']> {
  if (kind === 'router') {
    return { mode: 'rank_then_merge', fanOut: 'sequential', scoringPolicy: 'risk' };
  }
  if (kind === 'artifact') {
    return { mode: 'finalize' };
  }
  return { mode: 'fan_out_all', fanOut: 'parallel' };
}
