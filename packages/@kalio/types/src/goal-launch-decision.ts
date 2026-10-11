/** Version probe only; unknown versions do not expose or inspect their payload. */
export interface GoalLaunchDisclosureEnvelope {
  schemaVersion: number;
  disclosureId: string;
}
export interface GoalLaunchDisclosureV1 {
  schemaVersion: 1;
  kind: 'goal_launch';
  preset: { id: string; name: string };
  goal: string;
  behavior: 'attempt_goal_continuation_until_review_or_blocked';
  approvalBoundary: 'confirmation_required_actions_remain_independent';
  disclosureId: string;
}
export interface GoalLaunchDecisionInput {
  requestId: string;
  sessionId: string;
  disclosureId: string;
  decision: 'approve' | 'reject';
  message?: string;
}
/** Shape-only host metadata. Parsing does not establish source, hash or approval authority. */
export interface GoalLaunchHostRequirement {
  kind: 'human_only';
  toolName: 'run_sub_agentflow';
  callId: string;
  goalLaunch: {
    schemaVersion: 1;
    /** Actual waiting_for_human/tool_pending checkpoint revision, never derived. */
    parentWaitingRevision: number;
    disclosureSha256: string;
    argsSha256: string;
    parentRunId: string;
    parentSessionId: string;
    parentTurnId: string;
    promptMessageId: string;
    assistantMessageId: string;
    flowDefinitionId: string;
    schemaId: string;
    policyId: string;
    flowDefinitionSha256: string;
    schemaDefinitionSha256: string;
    policySha256: string;
  };
}
/** Server-written origin shape; parser alone does not prove authentication or row ownership. */
export interface GoalLaunchBrowserDecisionOrigin {
  schemaVersion: 1;
  kind: 'decision_browser_goal_launch';
  authorityMode: 'browser_cookie';
  requestId: string;
  sessionId: string;
  toolCallId: string;
  disclosureId: string;
  approvedFromRevision: number;
}

function invalid(): never { throw new Error('Invalid goal launch value.'); }
function plain(raw: unknown): object {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const prototype: unknown = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  return raw;
}
function own(raw: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(raw, key);
  if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
  return descriptor.value as unknown;
}
function exact(raw: object, required: readonly string[], optional: readonly string[] = []): void {
  const keys = Reflect.ownKeys(raw);
  if (!required.every(key => keys.includes(key))
    || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) return invalid();
  for (const key of keys) own(raw, key as string);
}
/** Count Unicode scalar values, rejecting lone UTF-16 surrogates. */
function scalarLength(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++, count++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return invalid();
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) return invalid();
  }
  return count;
}
function text(raw: unknown, max: number, trim: boolean, required: boolean): string {
  if (typeof raw !== 'string') return invalid();
  scalarLength(raw);
  if (trim && raw !== raw.trim()) return invalid();
  if (required && !raw.trim() || scalarLength(raw) > max) return invalid();
  return raw;
}
function disclosureId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{21}$/.test(raw)) return invalid();
  return raw;
}
function envelope(raw: object): GoalLaunchDisclosureEnvelope {
  const schemaVersion = own(raw, 'schemaVersion');
  if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion <= 0) return invalid();
  return { schemaVersion, disclosureId: disclosureId(own(raw, 'disclosureId')) };
}

export function parseGoalLaunchDisclosureEnvelope(raw: unknown): GoalLaunchDisclosureEnvelope {
  try { return envelope(plain(raw)); }
  catch { throw new Error('GOAL_LAUNCH_DISCLOSURE_ENVELOPE_INVALID'); }
}
export function parseGoalLaunchDisclosureV1(raw: unknown): GoalLaunchDisclosureV1 {
  try {
    const body = plain(raw);
    exact(body, ['schemaVersion', 'kind', 'preset', 'goal', 'behavior', 'approvalBoundary', 'disclosureId']);
    const version = envelope(body);
    if (version.schemaVersion !== 1 || own(body, 'kind') !== 'goal_launch'
      || own(body, 'behavior') !== 'attempt_goal_continuation_until_review_or_blocked'
      || own(body, 'approvalBoundary') !== 'confirmation_required_actions_remain_independent') return invalid();
    const preset = plain(own(body, 'preset'));
    exact(preset, ['id', 'name']);
    return { schemaVersion: 1, kind: 'goal_launch', preset: {
      id: text(own(preset, 'id'), 512, true, true), name: text(own(preset, 'name'), 200, true, true),
    }, goal: text(own(body, 'goal'), 32768, false, true),
    behavior: 'attempt_goal_continuation_until_review_or_blocked',
    approvalBoundary: 'confirmation_required_actions_remain_independent', disclosureId: version.disclosureId };
  } catch { throw new Error('GOAL_LAUNCH_DISCLOSURE_INVALID'); }
}
export function parseGoalLaunchDecisionInput(raw: unknown): GoalLaunchDecisionInput {
  try {
    const body = plain(raw);
    exact(body, ['requestId', 'sessionId', 'disclosureId', 'decision'], ['message']);
    const decision = own(body, 'decision');
    if (decision !== 'approve' && decision !== 'reject') return invalid();
    return { requestId: text(own(body, 'requestId'), 512, true, true),
      sessionId: text(own(body, 'sessionId'), 512, true, true), disclosureId: disclosureId(own(body, 'disclosureId')), decision,
      ...(Object.hasOwn(body, 'message') ? { message: text(own(body, 'message'), 2000, false, false) } : {}) };
  } catch { throw new Error('GOAL_LAUNCH_DECISION_INVALID'); }
}

function hash(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) return invalid();
  return raw;
}
export function parseGoalLaunchHostRequirement(raw: unknown): GoalLaunchHostRequirement {
  try {
    const body = plain(raw);
    exact(body, ['kind', 'toolName', 'callId', 'goalLaunch']);
    if (own(body, 'kind') !== 'human_only' || own(body, 'toolName') !== 'run_sub_agentflow') return invalid();
    const binding = plain(own(body, 'goalLaunch'));
    exact(binding, ['schemaVersion', 'parentWaitingRevision', 'disclosureSha256', 'argsSha256', 'parentRunId', 'parentSessionId', 'parentTurnId',
      'promptMessageId', 'assistantMessageId', 'flowDefinitionId', 'schemaId', 'policyId',
      'flowDefinitionSha256', 'schemaDefinitionSha256', 'policySha256']);
    const parentWaitingRevision = own(binding, 'parentWaitingRevision');
    if (own(binding, 'schemaVersion') !== 1 || typeof parentWaitingRevision !== 'number'
      || !Number.isSafeInteger(parentWaitingRevision) || parentWaitingRevision <= 0) return invalid();
    return { kind: 'human_only', toolName: 'run_sub_agentflow', callId: text(own(body, 'callId'), 512, true, true),
      goalLaunch: { schemaVersion: 1, parentWaitingRevision,
        disclosureSha256: hash(own(binding, 'disclosureSha256')), argsSha256: hash(own(binding, 'argsSha256')),
        parentRunId: text(own(binding, 'parentRunId'), 512, true, true),
        parentSessionId: text(own(binding, 'parentSessionId'), 512, true, true),
        parentTurnId: text(own(binding, 'parentTurnId'), 512, true, true),
        promptMessageId: text(own(binding, 'promptMessageId'), 512, true, true),
        assistantMessageId: text(own(binding, 'assistantMessageId'), 512, true, true),
        flowDefinitionId: text(own(binding, 'flowDefinitionId'), 512, true, true),
        schemaId: text(own(binding, 'schemaId'), 512, true, true),
        policyId: text(own(binding, 'policyId'), 512, true, true),
        flowDefinitionSha256: hash(own(binding, 'flowDefinitionSha256')),
        schemaDefinitionSha256: hash(own(binding, 'schemaDefinitionSha256')), policySha256: hash(own(binding, 'policySha256')),
      } };
  } catch { throw new Error('GOAL_LAUNCH_REQUIREMENT_INVALID'); }
}
export function parseGoalLaunchBrowserDecisionOrigin(raw: unknown): GoalLaunchBrowserDecisionOrigin {
  try {
    const body = plain(raw);
    exact(body, ['schemaVersion', 'kind', 'authorityMode', 'requestId', 'sessionId', 'toolCallId', 'disclosureId', 'approvedFromRevision']);
    const revision = own(body, 'approvedFromRevision');
    if (own(body, 'schemaVersion') !== 1 || own(body, 'kind') !== 'decision_browser_goal_launch'
      || own(body, 'authorityMode') !== 'browser_cookie' || typeof revision !== 'number'
      || !Number.isSafeInteger(revision) || revision <= 0) return invalid();
    return { schemaVersion: 1, kind: 'decision_browser_goal_launch', authorityMode: 'browser_cookie',
      requestId: text(own(body, 'requestId'), 512, true, true), sessionId: text(own(body, 'sessionId'), 512, true, true),
      toolCallId: text(own(body, 'toolCallId'), 512, true, true), disclosureId: disclosureId(own(body, 'disclosureId')),
      approvedFromRevision: revision };
  } catch { throw new Error('GOAL_LAUNCH_APPROVAL_ORIGIN_INVALID'); }
}
