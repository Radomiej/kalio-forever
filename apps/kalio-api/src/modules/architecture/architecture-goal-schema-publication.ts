import type { ArchitectureSchema } from '@kalio/types';
import { types } from 'node:util';
import { canonicalGoalLaunchJson, hashGoalLaunchJson } from '../../common/goal-launch-canonical';

type Rule = { read: (value: unknown) => unknown; optional?: true };
type Fields<T> = { [K in keyof T]-?: Rule };
const invalid = (): never => { throw new Error('GOAL_SCHEMA_PUBLICATION_INVALID'); };
const text: Rule = { read: value => typeof value === 'string' ? value : invalid() };
const nonempty: Rule = { read: value => typeof value === 'string' && value.trim() ? value : invalid() };
const boolean: Rule = { read: value => typeof value === 'boolean' ? value : invalid() };
const number: Rule = { read: value => typeof value === 'number' && Number.isFinite(value) ? value : invalid() };
const optional = (rule: Rule): Rule => ({ ...rule, optional: true });
const enumeration = (...values: string[]): Rule => ({ read: value => typeof value === 'string' && values.includes(value) ? value : invalid() });
const numeric = (check: (value: number) => boolean): Rule => ({ read: value => typeof value === 'number' && check(value) ? value : invalid() });

function descriptors(value: unknown, array = false): Record<string, PropertyDescriptor> {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return invalid();
  const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== null && proto !== Object.prototype) return invalid();
  const result: Record<string, PropertyDescriptor> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable && !(array && key === 'length')) return invalid();
    result[key] = descriptor;
  }
  return result;
}
function object<T>(fields: Fields<T>): Rule {
  return { read: value => {
    const source = descriptors(value); const result: Record<string, unknown> = Object.create(null);
    if (Object.keys(source).some(key => !Object.hasOwn(fields, key))) return invalid();
    for (const [key, rule] of Object.entries<Rule>(fields)) {
      const item: unknown = source[key]?.value;
      if (item === undefined) { if (rule.optional) continue; return invalid(); }
      result[key] = rule.read(item);
    }
    return result;
  } };
}
function array(rule: Rule): Rule {
  return { read: value => {
    if (!Array.isArray(value)) return invalid();
    const source = descriptors(value, true); const length: unknown = source.length?.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || Object.keys(source).length !== length + 1) return invalid();
    const result: unknown[] = [];
    for (let i = 0; i < length; i++) {
      if (!Object.hasOwn(source, String(i))) return invalid();
      result.push(rule.read(source[String(i)]!.value));
    }
    return result;
  } };
}
const compression = enumeration('none', 'summary', 'evidence_only');
type Context = ArchitectureSchema['contextPolicy'];
type Override = NonNullable<Context['perSlotOverrides']>[string];
const override = object<Override>({
  includeUserTask: optional(boolean), includeProjectMemory: optional(boolean), includeBrowserSession: optional(boolean),
  includePriorDecisions: optional(boolean), includeOtherAgentOutputs: optional(boolean), includeToolResults: optional(boolean),
  contextCompression: optional(compression),
} satisfies Fields<Override>);
const overrides: Rule = { read: value => {
  const source = descriptors(value); const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(source)) result[key] = override.read(source[key]!.value);
  return result;
} };
type Node = ArchitectureSchema['nodes'][number];
type Behavior = NonNullable<Node['behavior']>;
const node = object<Node>({
  id: nonempty, label: nonempty, kind: enumeration('parallel', 'role', 'router', 'artifact', 'auto_router'),
  roleSlotId: optional(text), maxToolAttempts: optional(numeric(v => Number.isInteger(v) && v >= 1 && v <= 100)),
  toolOverride: optional(object<NonNullable<Node['toolOverride']>>({ allowedToolNames: optional(array(nonempty)) })),
  behavior: optional(object<Behavior>({
    mode: enumeration('fan_out_all', 'choose_one', 'rank_then_merge', 'merge_inputs', 'finalize'),
    fanOut: optional(enumeration('parallel', 'sequential')), maxBranches: optional(numeric(v => Number.isInteger(v) && v > 0)),
    scoringPolicy: optional(enumeration('confidence', 'risk', 'cost', 'custom')), description: optional(text),
  } satisfies Fields<Behavior>)),
  autoRouting: optional(object<NonNullable<Node['autoRouting']>>({
    confidenceThreshold: numeric(v => Number.isFinite(v) && v >= 0 && v <= 1),
    instructions: { read: value => typeof value === 'string' && value.length <= 2000 ? value : invalid() },
  })), x: optional(number), y: optional(number),
} satisfies Fields<Node>);
type Slot = ArchitectureSchema['roleSlots'][number];
type Edge = ArchitectureSchema['edges'][number];
const schemaRule = object<ArchitectureSchema>({
  id: nonempty, name: nonempty, description: text, version: nonempty,
  roleSlots: array(object<Slot>({ id: nonempty, label: nonempty, description: text,
    slotType: enumeration('participant', 'router', 'judge', 'finalizer', 'critic', 'tool_executor'),
    defaultPersonaId: nonempty, allowedPersonaTags: array(text), required: boolean, canOverrideAtRunStart: boolean,
  } satisfies Fields<Slot>)), nodes: array(node),
  edges: array(object<Edge>({ id: nonempty, fromNodeId: nonempty, toNodeId: nonempty, label: optional(text),
    selection: optional(enumeration('default', 'converge', 'continuation', 'choice')), returnToOrchestrator: optional(boolean),
  } satisfies Fields<Edge>)),
  routerPolicy: object<ArchitectureSchema['routerPolicy']>({ mode: enumeration('rank_then_merge', 'evidence_first', 'risk_weighted'),
    mustAddressCriticFindings: boolean, canReturnNeedsMoreResearch: boolean }),
  contextPolicy: object<Context>({ includeUserTask: boolean, includeProjectMemory: boolean, includeBrowserSession: boolean,
    includePriorDecisions: boolean, includeOtherAgentOutputs: optional(boolean), includeToolResults: optional(boolean),
    contextCompression: optional(compression), perSlotOverrides: optional(overrides),
  } satisfies Fields<Context>),
  memoryPolicy: object<ArchitectureSchema['memoryPolicy']>({ persistFinalArtifact: boolean, persistRouterDecision: boolean }),
  outputArtifactSchema: text,
} satisfies Fields<ArchitectureSchema>);
export interface ArchitectureGoalSchemaPublicationV1 {
  schemaVersion: 1;
  kind: 'goal_schema';
  schemaId: string;
  definition: ArchitectureSchema;
}
export function publishArchitectureGoalSchema(schema: ArchitectureSchema): {
  publication: ArchitectureGoalSchemaPublicationV1; canonicalJson: string; sha256: string;
} {
  try {
    // Fixed-shape rules validate every owner key; dynamic entries never omit undefined.
    const definition = schemaRule.read(schema) as ArchitectureSchema;
    const publication: ArchitectureGoalSchemaPublicationV1 = { schemaVersion: 1, kind: 'goal_schema', schemaId: definition.id, definition };
    return { publication, canonicalJson: canonicalGoalLaunchJson(publication), sha256: hashGoalLaunchJson(publication) };
  } catch { return invalid(); }
}
