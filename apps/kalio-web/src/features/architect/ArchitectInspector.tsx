import { UserRoundCog } from 'lucide-react';
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
}

const NODE_KIND_OPTIONS: ReadonlyArray<{ value: ArchitectureNodeKind; label: string }> = [
  { value: 'parallel', label: 'Parallel' },
  { value: 'role', label: 'Role' },
  { value: 'router', label: 'Router' },
  { value: 'artifact', label: 'Artifact' },
];

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
}: ArchitectInspectorProps) {
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

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-base-300/80 bg-base-100/95" data-testid="architect-inspector">
      <div className="border-b border-base-300/80 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-base-content/70">
          <UserRoundCog size={14} className="text-sky-400" />
          Inspector
        </div>
      </div>

      {!node && (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-base-content/40">
          Select a graph node or slot to inspect its runtime configuration.
        </div>
      )}

      {node && (
        <div className="flex-1 overflow-y-auto p-3">
          <h2 className="truncate text-sm font-semibold text-base-content">{node.label}</h2>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="badge badge-info badge-sm">{node.role ?? node.kind}</span>
            {node.roleSlotId && <span className="badge badge-ghost badge-sm">{node.roleSlotId}</span>}
            {node.personaId && <span className="badge badge-ghost badge-sm">{node.personaId}</span>}
          </div>
          {node.description && (
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-base-content/60">{node.description}</p>
          )}

          <div className="mt-4 form-control gap-1">
            <label className="label-text text-xs font-semibold text-base-content/70">Persona override</label>
            <select
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

          <div className="mt-3 form-control gap-1">
            <label className="label-text text-xs font-semibold text-base-content/70">Processing type</label>
            <select
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

          {selectedPersona && (
            <div className="mt-3 rounded-md border border-base-300/80 bg-base-200/60 p-2.5">
              <div className="text-xs font-semibold text-base-content">{selectedPersona.name}</div>
              <div className="mt-1 text-[11px] text-base-content/45">{selectedPersona.model ?? 'default model'}</div>
              <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-base-content/55">
                {selectedPersona.systemPrompt}
              </p>
            </div>
          )}

          {slot && (
            <section className="mt-4 rounded-md border border-sky-500/25 bg-sky-500/10 p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-sky-300">Selected slot</div>
              <div className="mt-1 text-sm font-semibold text-base-content">{slot.label}</div>
              <div className="mt-1 text-xs text-base-content/55">{slot.slotType ?? slot.kind ?? 'slot'}</div>
              {slot.description && (
                <p className="mt-2 text-xs leading-relaxed text-base-content/60">{slot.description}</p>
              )}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
