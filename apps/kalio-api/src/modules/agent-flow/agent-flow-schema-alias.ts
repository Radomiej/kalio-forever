import { canonicalGoalLaunchJson, hashGoalLaunchJson } from '../../common/goal-launch-canonical';

const FLOW_SCHEMA_ALIASES: Record<string, string> = {
  goal_guard_delivery_loop: 'goal-master-delivery-loop',
};

export function schemaIdForFlow(flowId: string): string {
  return Object.hasOwn(FLOW_SCHEMA_ALIASES, flowId) ? FLOW_SCHEMA_ALIASES[flowId]! : flowId;
}

const invalid = (): never => { throw new Error('GOAL_SCHEMA_ALIAS_PUBLICATION_INVALID'); };

function assertId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value !== value.trim()) return invalid();
  let count = 0;
  for (const point of value) {
    const unit = point.charCodeAt(0);
    if (++count > 512 || point.length === 1 && unit >= 0xd800 && unit <= 0xdfff) return invalid();
  }
}

/** Publishes the owner's alias only, not registry existence or launch eligibility. */
export function publishSchemaAliasFlow(flowDefinitionId: string, schemaId: string, schemaDefinitionSha256: string): {
  publication: { schemaVersion: 1; kind: 'schema_alias'; flowDefinitionId: string; schemaId: string; schemaDefinitionSha256: string };
  canonicalJson: string; sha256: string;
} {
  try {
    assertId(flowDefinitionId); assertId(schemaId);
    if (typeof schemaDefinitionSha256 !== 'string' || schemaDefinitionSha256.length !== 64
      || !/^[a-f0-9]{64}$/.test(schemaDefinitionSha256) || schemaId !== schemaIdForFlow(flowDefinitionId)) return invalid();
    const publication = { schemaVersion: 1 as const, kind: 'schema_alias' as const,
      flowDefinitionId, schemaId, schemaDefinitionSha256 };
    return { publication, canonicalJson: canonicalGoalLaunchJson(publication), sha256: hashGoalLaunchJson(publication) };
  } catch { return invalid(); }
}

