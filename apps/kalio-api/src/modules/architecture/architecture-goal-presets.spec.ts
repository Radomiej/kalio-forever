import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureSchema } from '@kalio/types';
import { DEVIN_JEV_GOAL_LOOP } from './architecture-seed-schemas.devin-jev';
import { lookupGoalGraphAdapterConfig } from './architecture-goal-presets';
import { isArchitectureRuntimeSchema } from './architecture-runtime-schema.utils';
import { ArchitectureRegistryService } from './architecture-registry.service';

const hostPolicy = vi.fn(() => ({ requiredEvidenceKindsByCriterion: {} }));
const snapshot = () => structuredClone(DEVIN_JEV_GOAL_LOOP);

describe('Devin–Jev preset (configuration only, no runtime activation)', () => {
  it('uses a valid two-role schema with worker first and a host-only terminal', () => {
    const schema = snapshot();
    expect(isArchitectureRuntimeSchema(schema)).toBe(true);
    expect(schema.roleSlots.map(slot => [slot.id, slot.defaultPersonaId, slot.canOverrideAtRunStart])).toEqual([
      ['worker', 'agent-implementer', false], ['judge', 'agent-release-guard', false],
    ]);
    expect(schema.nodes.map(node => [node.id, node.kind, node.roleSlotId])).toEqual([
      ['devin-worker', 'role', 'worker'], ['jev-judge', 'role', 'judge'], ['goal-artifact', 'artifact', undefined],
    ]);
    expect(schema.nodes[1]?.toolOverride).toEqual({ allowedToolNames: [] });
    expect(schema.edges.map(edge => [edge.fromNodeId, edge.toNodeId, edge.selection])).toEqual([
      ['devin-worker', 'jev-judge', undefined], ['jev-judge', 'devin-worker', 'continuation'], ['jev-judge', 'goal-artifact', 'choice'],
    ]);
    expect(schema.edges.some(edge => edge.returnToOrchestrator)).toBe(false);
  });

  it('returns exact host config without executing or substituting the supplied policy', () => {
    const config = lookupGoalGraphAdapterConfig(snapshot(), hostPolicy);
    expect(config).toEqual({ workerNodeId: 'devin-worker', judgeNodeId: 'jev-judge', completionNodeIds: ['goal-artifact'], hostPolicyFactory: hostPolicy });
    expect(hostPolicy).not.toHaveBeenCalled();
  });

  it('accepts a JSON round trip with reordered object keys', () => {
    const reordered = JSON.parse(JSON.stringify(snapshot(), (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse()) : value)) as ArchitectureSchema;
    expect(lookupGoalGraphAdapterConfig(reordered, hostPolicy)).not.toBeNull();
  });

  const mutations: [string, (schema: ArchitectureSchema) => void][] = [
    ['id', schema => { schema.id = 'devin-jev-goal-loop-variant-1'; }],
    ['version', schema => { schema.version = '0.1.1'; }],
    ['persona', schema => { schema.roleSlots[1]!.defaultPersonaId = 'default'; }],
    ['role override', schema => { schema.roleSlots[0]!.canOverrideAtRunStart = true; }],
    ['node kind', schema => { schema.nodes[1]!.kind = 'router'; }],
    ['worker ordering', schema => { schema.nodes.reverse(); }],
    ['tool policy', schema => { schema.nodes[1]!.toolOverride = { allowedToolNames: ['terminal_exec'] }; }],
    ['edge default', schema => { schema.edges[2]!.selection = 'default'; }],
    ['edge target', schema => { schema.edges[0]!.toNodeId = 'goal-artifact'; }],
    ['edge ordering', schema => { schema.edges.reverse(); }],
    ['terminal persona', schema => { schema.nodes[2]!.roleSlotId = 'judge'; }],
    ['context policy', schema => { schema.contextPolicy.includeToolResults = false; }],
    ['memory policy', schema => { schema.memoryPolicy.persistFinalArtifact = false; }],
    ['description', schema => { schema.description = 'Modified snapshot'; }],
    ['extra context', schema => { Object.assign(schema, { context: { workerNodeId: 'forged', goalProtocol: 1 } }); }],
  ];
  it.each(mutations)('rejects modified %s even with the canonical identity', (_name, mutate) => {
    const schema = snapshot(); mutate(schema);
    expect(lookupGoalGraphAdapterConfig(schema, hostPolicy)).toBeNull();
  });

  it('returns isolated configs and does not register the inactive preset', () => {
    const first = lookupGoalGraphAdapterConfig(snapshot(), hostPolicy)!;
    expect(first).not.toBeNull();
    expect(lookupGoalGraphAdapterConfig(snapshot(), hostPolicy)).not.toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.completionNodeIds)).toBe(true);
    expect(new ArchitectureRegistryService().findOne(DEVIN_JEV_GOAL_LOOP.id)).toBeNull();
  });

  it('rejects invalid JSON and does not honor a toJSON replacement', () => {
    const cyclic = snapshot(); Object.assign(cyclic, { self: cyclic });
    expect(lookupGoalGraphAdapterConfig(cyclic, hostPolicy)).toBeNull();
    const forged = snapshot(); forged.nodes[1]!.kind = 'router';
    Object.assign(forged, { toJSON: () => snapshot() });
    expect(lookupGoalGraphAdapterConfig(forged, hostPolicy)).toBeNull();
  });

  it.each(['object', 'array'] as const)('rejects %s accessors without invoking their getters', kind => {
    const schema = snapshot();
    let reads = 0;
    const target = kind === 'object' ? schema.nodes[1]! : schema.nodes;
    const key = kind === 'object' ? 'label' : '1';
    const original = kind === 'object' ? schema.nodes[1]!.label : schema.nodes[1];
    Object.defineProperty(target, key, { enumerable: true, configurable: true, get: () => { reads += 1; return original; } });
    expect(lookupGoalGraphAdapterConfig(schema, hostPolicy)).toBeNull();
    expect(reads).toBe(0);
  });

  it.each(['symbol', 'nonenumerable', 'sparse', 'array prototype', 'array extra property', 'array hidden property', 'array symbol', 'setter', 'unknown undefined'])(
    'rejects a snapshot with %s properties', kind => {
      const schema = snapshot();
      if (kind === 'symbol') Object.defineProperty(schema.nodes[1]!, Symbol('hidden'), { value: true });
      if (kind === 'nonenumerable') Object.defineProperty(schema.nodes[1]!, 'hidden', { value: true });
      if (kind === 'sparse') delete schema.nodes[1];
      if (kind === 'array prototype') Object.setPrototypeOf(schema.nodes, Object.create(Array.prototype));
      if (kind === 'array extra property') Object.assign(schema.nodes, { hidden: true });
      if (kind === 'array hidden property') Object.defineProperty(schema.nodes, 'hidden', { value: true });
      if (kind === 'array symbol') Object.defineProperty(schema.nodes, Symbol('hidden'), { value: true });
      if (kind === 'setter') Object.defineProperty(schema.nodes[1]!, 'label', { enumerable: true, set: () => undefined });
      if (kind === 'unknown undefined') Object.assign(schema.nodes[1]!, { hidden: undefined });
      expect(lookupGoalGraphAdapterConfig(schema, hostPolicy)).toBeNull();
    },
  );

  it('retains optional undefined properties added by existing schema clone helpers', () => {
    const schema = snapshot();
    schema.nodes.forEach(node => Object.assign(node, { autoRouting: undefined, ...(node.toolOverride ? {} : { toolOverride: undefined }) }));
    Object.assign(schema.contextPolicy, { perSlotOverrides: undefined });
    expect(lookupGoalGraphAdapterConfig(schema, hostPolicy)).not.toBeNull();
  });
});
