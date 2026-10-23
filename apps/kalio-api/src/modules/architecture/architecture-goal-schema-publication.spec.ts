import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { ArchitectureSchema } from '@kalio/types';
import { publishArchitectureGoalSchema } from './architecture-goal-schema-publication';
import { ArchitectureRegistryService } from './architecture-registry.service';

function full(): ArchitectureSchema {
  return { id: 'schema', name: 'Schema', description: 'Żółć 😀', version: '1',
    roleSlots: [{ id: 'slot', label: 'Slot', description: '', slotType: 'participant', defaultPersonaId: 'persona',
      allowedPersonaTags: ['one','two'], required: true, canOverrideAtRunStart: false }],
    nodes: [{ id: 'node', label: 'Node', kind: 'parallel', roleSlotId: 'slot', maxToolAttempts: 30,
      toolOverride: { allowedToolNames: ['fs_read'] }, behavior: { mode: 'fan_out_all', fanOut: 'sequential', maxBranches: 2, scoringPolicy: 'risk', description: '' },
      autoRouting: { confidenceThreshold: 0.95, instructions: '' }, x: 0, y: -3 }],
    edges: [{ id: 'edge', fromNodeId: 'node', toNodeId: 'other', label: '', selection: 'continuation', returnToOrchestrator: false }],
    routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: false },
    contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: true,
      includeOtherAgentOutputs: false, includeToolResults: true, contextCompression: 'none', perSlotOverrides: { slot: {
        includeUserTask: false, includeProjectMemory: true, includeBrowserSession: false, includePriorDecisions: true,
        includeOtherAgentOutputs: false, includeToolResults: false, contextCompression: 'evidence_only' } } },
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: false }, outputArtifactSchema: '' };
}
it('publishes the complete owner shape without eligibility inference, preserving empty/false/zero', () => {
  const schema = full(); const result = publishArchitectureGoalSchema(schema);
  expect(result.publication).toEqual({ schemaVersion: 1, kind: 'goal_schema', schemaId: 'schema', definition: schema });
  expect(JSON.parse(result.canonicalJson)).toEqual(result.publication);
  expect(result.sha256).toBe(createHash('sha256').update(result.canonicalJson, 'utf8').digest('hex'));
});
it('maps actual registry clones with synthesized undefined identically to named omissions', () => {
  const schema = new ArchitectureRegistryService().findAll()[0]!;
  const published = publishArchitectureGoalSchema(schema);
  expect(Object.hasOwn(schema.nodes[0]!, 'toolOverride')).toBe(true);
  expect(Object.hasOwn(published.publication.definition.nodes[0]!, 'toolOverride')).toBe(false);
  const omitted = { ...schema, nodes: schema.nodes.map(node => {
    const clean = { ...node }; if (clean.toolOverride === undefined) delete clean.toolOverride;
    if (clean.autoRouting === undefined) delete clean.autoRouting; return clean;
  }), contextPolicy: { ...schema.contextPolicy } };
  if (omitted.contextPolicy.perSlotOverrides === undefined) delete omitted.contextPolicy.perSlotOverrides;
  expect(publishArchitectureGoalSchema(omitted).sha256).toBe(published.sha256);
});
it('detaches every nested field and array from subsequent owner mutation', () => {
  const schema = full(); const result = publishArchitectureGoalSchema(schema); const before = result.canonicalJson;
  schema.nodes[0]!.toolOverride!.allowedToolNames!.push('fs_write');
  schema.nodes[0]!.behavior!.description = 'changed'; schema.contextPolicy.perSlotOverrides!.slot!.includeToolResults = true;
  schema.roleSlots[0]!.allowedPersonaTags.push('changed'); schema.edges[0]!.label = 'changed';
  expect(JSON.stringify(result.publication)).not.toContain('changed');
  expect(result.canonicalJson).toBe(before);
  expect(publishArchitectureGoalSchema(schema).sha256).not.toBe(result.sha256);
});
it('binds each present owner leaf to the hash, including optional policy and layout', () => {
  function mutateLeaves(value: unknown, path: string[] = []): string[][] {
    if (!value || typeof value !== 'object') return [path];
    return Object.entries(value).flatMap(([key, item]) => mutateLeaves(item, [...path, key]));
  }
  const baseline = full(); const hash = publishArchitectureGoalSchema(baseline).sha256;
  for (const path of mutateLeaves(baseline)) {
    const changed = full(); let cursor: Record<string, unknown> = changed as unknown as Record<string, unknown>;
    for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
    const key = path[path.length-1]!; const prior = cursor[key];
    const alternatives: Record<string, string> = { participant: 'judge', parallel: 'role', fan_out_all: 'choose_one',
      sequential: 'parallel', risk: 'cost', continuation: 'choice', evidence_first: 'risk_weighted', none: 'summary', evidence_only: 'none' };
    cursor[key] = typeof prior === 'boolean' ? !prior : typeof prior === 'number' ? (key === 'confidenceThreshold' ? 0.5 : prior+1)
      : alternatives[String(prior)] ?? String(prior)+'changed';
    expect(publishArchitectureGoalSchema(changed).sha256, path.join('.')).not.toBe(hash);
  }
});
it('omits undefined at every named optional field only', () => {
  const schema = full(); const baseline = publishArchitectureGoalSchema(schema);
  const targets: Array<[Record<string, unknown>, string[]]> = [
    [schema.nodes[0]! as unknown as Record<string, unknown>, ['roleSlotId','maxToolAttempts','toolOverride','behavior','autoRouting','x','y']],
    [schema.nodes[0]!.behavior! as unknown as Record<string, unknown>, ['fanOut','maxBranches','scoringPolicy','description']],
    [schema.nodes[0]!.toolOverride! as unknown as Record<string, unknown>, ['allowedToolNames']],
    [schema.edges[0]! as unknown as Record<string, unknown>, ['label','selection','returnToOrchestrator']],
    [schema.contextPolicy as unknown as Record<string, unknown>, ['includeOtherAgentOutputs','includeToolResults','contextCompression','perSlotOverrides']],
    [schema.contextPolicy.perSlotOverrides!.slot! as unknown as Record<string, unknown>, ['includeUserTask','includeProjectMemory','includeBrowserSession','includePriorDecisions','includeOtherAgentOutputs','includeToolResults','contextCompression']],
  ];
  // Compare each omission in isolation, including nested optional fields.
  for (const [target, keys] of targets) for (const key of keys) {
    const saved: unknown = target[key]; target[key] = undefined;
    const withUndefined = publishArchitectureGoalSchema(schema); delete target[key];
    expect(publishArchitectureGoalSchema(schema)).toEqual(withUndefined); target[key] = saved;
  }
  expect(publishArchitectureGoalSchema(schema)).toEqual(baseline);
});
it('has an independent canonical golden for an empty structural owner', () => {
  const schema: ArchitectureSchema = { id:'s',name:'n',description:'',version:'1',roleSlots:[],nodes:[],edges:[],
    routerPolicy:{mode:'evidence_first',mustAddressCriticFindings:false,canReturnNeedsMoreResearch:false},
    contextPolicy:{includeUserTask:false,includeProjectMemory:false,includeBrowserSession:false,includePriorDecisions:false},
    memoryPolicy:{persistFinalArtifact:false,persistRouterDecision:false},outputArtifactSchema:'' };
  const golden = '{"definition":{"contextPolicy":{"includeBrowserSession":false,"includePriorDecisions":false,"includeProjectMemory":false,"includeUserTask":false},"description":"","edges":[],"id":"s","memoryPolicy":{"persistFinalArtifact":false,"persistRouterDecision":false},"name":"n","nodes":[],"outputArtifactSchema":"","roleSlots":[],"routerPolicy":{"canReturnNeedsMoreResearch":false,"mode":"evidence_first","mustAddressCriticFindings":false},"version":"1"},"kind":"goal_schema","schemaId":"s","schemaVersion":1}';
  const result = publishArchitectureGoalSchema(schema);
  expect(result.canonicalJson).toBe(golden);
  expect(result.sha256).toBe(createHash('sha256').update(golden).digest('hex'));
});
it('rejects malformed scalar constraints and non-JSON data with static errors', () => {
  for (const mutate of [
    (s: ArchitectureSchema) => { s.nodes[0]!.maxToolAttempts = 101; },
    (s: ArchitectureSchema) => { s.nodes[0]!.behavior!.maxBranches = 0; },
    (s: ArchitectureSchema) => { s.nodes[0]!.autoRouting!.confidenceThreshold = NaN; },
    (s: ArchitectureSchema) => { s.nodes[0]!.autoRouting!.instructions = 'x'.repeat(2001); },
    (s: ArchitectureSchema) => { s.nodes[0]!.x = Infinity; },
    (s: ArchitectureSchema) => { s.name = '\ud800'; },
    (s: ArchitectureSchema) => { Object.defineProperty(s, 'name', { value:'n',enumerable:false }); },
    (s: ArchitectureSchema) => { Object.defineProperty(s, Symbol('secret'), { value:1 }); },
    (s: ArchitectureSchema) => { Object.setPrototypeOf(s.nodes[0], { inherited:1 }); },
  ]) { const schema = full(); mutate(schema); expect(() => publishArchitectureGoalSchema(schema)).toThrow(/^GOAL_SCHEMA_PUBLICATION_INVALID$/); }
});
it('rejects required, array and dynamic undefined and unknown keys', () => {
  for (const mutate of [
    (s: ArchitectureSchema) => { (s as unknown as Record<string, unknown>).description = undefined; },
    (s: ArchitectureSchema) => { (s.nodes as unknown[])[0] = undefined; },
    (s: ArchitectureSchema) => { (s.contextPolicy.perSlotOverrides as Record<string, unknown>).slot = undefined; },
    (s: ArchitectureSchema) => { (s as unknown as Record<string, unknown>).extra = undefined; },
    (s: ArchitectureSchema) => { (s.nodes[0] as unknown as Record<string, unknown>).extra = 1; },
  ]) { const schema = full(); mutate(schema); expect(() => publishArchitectureGoalSchema(schema)).toThrow(/^GOAL_SCHEMA_PUBLICATION_INVALID$/); }
});
it('rejects accessors/proxies/cycles/functions/sparse arrays without invoking getters', () => {
  const getter = vi.fn(() => { throw new Error('PRIVATE'); });
  const schema = full(); Object.defineProperty(schema.nodes[0], 'label', { enumerable: true, get: getter });
  expect(() => publishArchitectureGoalSchema(schema)).toThrow(/^GOAL_SCHEMA_PUBLICATION_INVALID$/); expect(getter).not.toHaveBeenCalled();
  expect(() => publishArchitectureGoalSchema(new Proxy(full(), { get: getter }))).toThrow(/^GOAL_SCHEMA_PUBLICATION_INVALID$/); expect(getter).not.toHaveBeenCalled();
  for (const mutate of [
    (s: ArchitectureSchema) => { (s.nodes[0] as unknown as Record<string, unknown>).behavior = s; },
    (s: ArchitectureSchema) => { (s as unknown as Record<string, unknown>).name = () => 'secret'; },
    (s: ArchitectureSchema) => { delete s.nodes[0]; },
  ]) { const raw = full(); mutate(raw); expect(() => publishArchitectureGoalSchema(raw)).toThrow(/^GOAL_SCHEMA_PUBLICATION_INVALID$/); }
});
