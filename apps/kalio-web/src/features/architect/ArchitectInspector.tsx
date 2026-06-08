import { useState } from 'react';
import { HelpCircle, Settings2, UserRoundCog, X } from 'lucide-react';
import type { ArchitectNode, ArchitectPersona, ArchitectSlot, NodeKindOverrideMap, PersonaOverrideMap } from './architect.types';
import type { ArchitectureContextPolicyOverride, ArchitectureNodeKind, ArchitectureSchemaNode } from '@kalio/types';
import type { ArchitectSchema } from './architect.types';
import { ArchitectBehaviorControls } from './ArchitectBehaviorControls';

interface ArchitectInspectorProps {
  node: ArchitectNode | null;
  slot: ArchitectSlot | null;
  schema: ArchitectSchema | null;
  personas: ArchitectPersona[];
  personaOverrides: PersonaOverrideMap;
  nodeKindOverrides: NodeKindOverrideMap;
  onPersonaOverride: (nodeId: string, personaId: string) => void;
  onNodeKindOverride: (nodeId: string, kind: ArchitectureNodeKind) => void;
  onNodeBehaviorOverride: (nodeId: string, behavior: NonNullable<ArchitectureSchemaNode['behavior']>) => void;
  onContextPolicyOverride: (slotId: string, override: ArchitectureContextPolicyOverride) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const NODE_KIND_OPTIONS: ReadonlyArray<{ value: ArchitectureNodeKind; label: string }> = [
  { value: 'parallel', label: 'Parallel' },
  { value: 'role', label: 'Role' },
  { value: 'router', label: 'Router' },
  { value: 'artifact', label: 'Artifact' },
];

function HelpTip({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;

  return (
    <span
      className="tooltip tooltip-left inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-base-300/80 bg-base-200/60 text-base-content/45 hover:text-sky-200"
      data-tip={value}
      aria-label={`${label}: ${value}`}
    >
      <HelpCircle size={12} />
    </span>
  );
}

export function ArchitectInspector({
  node,
  slot,
  schema,
  personas,
  personaOverrides,
  nodeKindOverrides,
  onPersonaOverride,
  onNodeKindOverride,
  onNodeBehaviorOverride,
  onContextPolicyOverride,
  collapsed = false,
  onCollapsedChange,
}: ArchitectInspectorProps) {
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const overrideKey = node?.roleSlotId ?? node?.id ?? '';
  const selectedPersonaId = node ? personaOverrides[overrideKey] ?? node.personaId ?? '' : '';
  const selectedPersona = personas.find((persona) => persona.id === selectedPersonaId);
  const selectedNodeKind = node ? nodeKindOverrides[node.id] ?? node.kind : 'role';
  const roleSlotId = node?.roleSlotId;
  const contextOverride = roleSlotId ? schema?.contextPolicy.perSlotOverrides?.[roleSlotId] ?? {} : {};
  const updateContextOverride = (patch: ArchitectureContextPolicyOverride) => {
    if (!roleSlotId) return;
    onContextPolicyOverride(roleSlotId, { ...contextOverride, ...patch });
  };
  const routingSummary = node?.behavior?.mode
    ? NODE_ROUTING_LABELS[node.behavior.mode] ?? node.behavior.mode
    : selectedNodeKind === 'router'
      ? 'Rank then merge'
      : selectedNodeKind === 'artifact'
        ? 'Finalize'
        : 'Run all outgoing';

  if (collapsed) {
    return (
      <aside
        className="flex h-full w-11 shrink-0 flex-col items-center border-l border-base-300/80 bg-base-100/95 py-2"
        data-testid="architect-inspector"
        data-collapsed="true"
      >
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square h-8 min-h-8 w-8"
          aria-label="Show inspector"
          title="Show inspector"
          onClick={() => onCollapsedChange?.(false)}
          data-testid="architect-inspector-expand"
        >
          <UserRoundCog size={14} className="text-sky-400" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-base-300/80 bg-base-100/95" data-testid="architect-inspector">
      <div className="border-b border-base-300/80 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-base-content/70">
          <UserRoundCog size={14} className="text-sky-400" />
          <span className="min-w-0 flex-1">Inspector</span>
          {onCollapsedChange && (
            <button
              type="button"
              className="btn btn-ghost btn-xs h-7 min-h-7 px-2 text-[10px]"
              aria-label="Hide inspector"
              title="Hide inspector"
              onClick={() => onCollapsedChange(true)}
              data-testid="architect-inspector-collapse"
            >
              Hide
            </button>
          )}
        </div>
      </div>

      {!node && (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-base-content/60">
          Select a graph node or slot to inspect its runtime configuration.
        </div>
      )}

      {node && (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-base-content">{node.label}</h2>
            <HelpTip label="Node description" value={node.description} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="badge badge-info badge-sm">{node.role ?? node.kind}</span>
            {node.roleSlotId && <span className="badge badge-ghost badge-sm">{node.roleSlotId}</span>}
            {node.personaId && <span className="badge badge-ghost badge-sm">{node.personaId}</span>}
          </div>

          <div className="mt-4 form-control gap-1">
            <label className="label-text text-xs font-semibold text-base-content/70">Persona override</label>
            <select
              aria-label="Persona override"
              className="select select-bordered select-sm h-9 min-h-9 w-full"
              value={selectedPersonaId}
              onChange={(event) => onPersonaOverride(overrideKey, event.target.value)}
              data-testid="architect-persona-select"
            >
              <option value="">Use schema default</option>
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name}
                </option>
              ))}
            </select>
          </div>

          <section className="mt-3 rounded-md border border-base-300/80 bg-base-200/45 p-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wide text-base-content/55">Node properties</div>
                <div className="mt-1 truncate text-xs text-base-content/70" data-testid="architect-node-properties-summary">
                  {NODE_KIND_LABELS[selectedNodeKind]} · {routingSummary}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs h-7 min-h-7 gap-1 px-2 text-[10px]"
                onClick={() => setPropertiesOpen(true)}
                data-testid="architect-node-properties-open"
              >
                <Settings2 size={12} />
                Edit
              </button>
            </div>
          </section>

          {selectedPersona && (
            <div className="mt-3 rounded-md border border-base-300/80 bg-base-200/60 p-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-base-content">{selectedPersona.name}</div>
                  <div className="mt-1 truncate text-[11px] text-base-content/65">{selectedPersona.model ?? 'default model'}</div>
                </div>
                <HelpTip label="Persona prompt" value={selectedPersona.systemPrompt} />
              </div>
            </div>
          )}

          {slot && (
            <section className="mt-4 rounded-md border border-sky-500/25 bg-sky-500/10 p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-sky-300">Selected slot</div>
              <div className="mt-1 flex items-start gap-2">
                <div className="min-w-0 flex-1 text-sm font-semibold text-base-content">{slot.label}</div>
                <HelpTip label="Slot description" value={slot.description} />
              </div>
              <div className="mt-1 text-xs text-base-content/55">{slot.slotType ?? slot.kind ?? 'slot'}</div>
            </section>
          )}
        </div>
      )}

      {node && propertiesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="architect-node-properties-title">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-lg border border-base-300 bg-base-100 shadow-2xl" data-testid="architect-node-properties-modal">
            <div className="flex items-center gap-3 border-b border-base-300 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 id="architect-node-properties-title" className="truncate text-sm font-semibold text-base-content">Node properties</h2>
                <p className="truncate text-xs text-base-content/55">{node.label}</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square h-8 min-h-8 w-8"
                aria-label="Close node properties"
                onClick={() => setPropertiesOpen(false)}
                data-testid="architect-node-properties-close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="form-control gap-1">
                <label className="label-text text-xs font-semibold text-base-content/70">Processing type</label>
                <select
                  aria-label="Processing type"
                  className="select select-bordered select-sm h-9 min-h-9 w-full"
                  value={selectedNodeKind}
                  onChange={(event) => onNodeKindOverride(node.id, event.target.value as ArchitectureNodeKind)}
                  data-testid="architect-node-kind-select"
                >
                  {NODE_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {(selectedNodeKind === 'parallel' || selectedNodeKind === 'router') && (
                <ArchitectBehaviorControls
                  node={{ ...node, kind: selectedNodeKind }}
                  schema={schema}
                  onChange={onNodeBehaviorOverride}
                />
              )}

              {roleSlotId && (
                <section className="mt-4 rounded-md border border-base-300/80 bg-base-200/50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-base-content/55">Context policy</div>
                  <label className="mt-2 flex items-center justify-between gap-3 text-xs text-base-content/70">
                    <span>Previous node outputs</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-info toggle-xs"
                      checked={contextOverride.includeOtherAgentOutputs ?? schema?.contextPolicy.includeOtherAgentOutputs ?? true}
                      onChange={(event) => updateContextOverride({ includeOtherAgentOutputs: event.target.checked })}
                      data-testid="architect-context-include-outputs"
                    />
                  </label>
                  <label className="mt-2 flex items-center justify-between gap-3 text-xs text-base-content/70">
                    <span>Browser session</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-info toggle-xs"
                      checked={contextOverride.includeBrowserSession ?? schema?.contextPolicy.includeBrowserSession ?? false}
                      onChange={(event) => updateContextOverride({ includeBrowserSession: event.target.checked })}
                      data-testid="architect-context-browser-session"
                    />
                  </label>
                  <label className="mt-2 flex items-center justify-between gap-3 text-xs text-base-content/70">
                    <span>Prior decisions</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-info toggle-xs"
                      checked={contextOverride.includePriorDecisions ?? schema?.contextPolicy.includePriorDecisions ?? false}
                      onChange={(event) => updateContextOverride({ includePriorDecisions: event.target.checked })}
                      data-testid="architect-context-prior-decisions"
                    />
                  </label>
                  <div className="mt-2 form-control gap-1">
                    <label className="label-text text-[11px] font-semibold text-base-content/60">Compression</label>
                    <select
                      aria-label="Context compression"
                      className="select select-bordered select-xs h-8 min-h-8 w-full"
                      value={contextOverride.contextCompression ?? schema?.contextPolicy.contextCompression ?? 'none'}
                      onChange={(event) => updateContextOverride({
                        contextCompression: event.target.value as NonNullable<ArchitectureContextPolicyOverride['contextCompression']>,
                      })}
                      data-testid="architect-context-compression"
                    >
                      <option value="none">None</option>
                      <option value="summary">Summary</option>
                      <option value="evidence_only">Evidence only</option>
                    </select>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

const NODE_KIND_LABELS: Record<ArchitectureNodeKind, string> = {
  artifact: 'Artifact',
  parallel: 'Parallel',
  role: 'Role',
  router: 'Router',
};

const NODE_ROUTING_LABELS: Partial<Record<NonNullable<ArchitectureSchemaNode['behavior']>['mode'], string>> = {
  choose_one: 'Choose one path',
  fan_out_all: 'Run all outgoing',
  finalize: 'Finalize',
  merge_inputs: 'Merge inputs',
  rank_then_merge: 'Rank then merge',
};
