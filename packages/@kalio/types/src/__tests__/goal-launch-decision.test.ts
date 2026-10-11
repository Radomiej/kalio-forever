import { describe, expect, it, vi } from 'vitest';
import { parseGoalLaunchDecisionInput, parseGoalLaunchDisclosureEnvelope, parseGoalLaunchDisclosureV1,
  parseGoalLaunchHostRequirement, parseGoalLaunchBrowserDecisionOrigin } from '../goal-launch-decision';

const disclosureId = 'Abcdefghijklmnopq_12-';
const disclosure = () => ({ schemaVersion: 1, kind: 'goal_launch', preset: { id: 'preset', name: 'Devin + Jev' },
  goal: '  Build Żółć 😀\n', behavior: 'attempt_goal_continuation_until_review_or_blocked',
  approvalBoundary: 'confirmation_required_actions_remain_independent', disclosureId });
const decision = () => ({ requestId: 'request', sessionId: 'session', disclosureId, decision: 'approve' });
describe('goal launch DTO parsers', () => {
  it('parses golden disclosure, preserving goal and detaching nested preset', () => {
    const raw = disclosure(); const parsed = parseGoalLaunchDisclosureV1(raw);
    expect(parsed).toEqual(raw); expect(parsed.preset).not.toBe(raw.preset);
  });
  it('preserves valid IDs/names exactly and optional empty or whitespace message', () => {
    expect(parseGoalLaunchDisclosureV1({ ...disclosure(), preset: { id: 'p', name: 'Name' } }).preset).toEqual({ id: 'p', name: 'Name' });
    expect(parseGoalLaunchDecisionInput({ ...decision(), requestId: 'r', sessionId: 's', message: '' })).toEqual({ ...decision(), requestId: 'r', sessionId: 's', message: '' });
    expect(parseGoalLaunchDecisionInput({ ...decision(), decision: 'reject', message: ' \n' }).message).toBe(' \n');
  });
  it.each([' ', '\t', '\n', '\u00A0', '\u2003', '\uFEFF'])('rejects padded IDs/names with whitespace %j without normalization', whitespace => {
    for (const padded of [whitespace+'value', 'value'+whitespace, whitespace+'value'+whitespace]) {
      for (const field of ['id', 'name']) {
        expect(() => parseGoalLaunchDisclosureV1({ ...disclosure(), preset: { ...disclosure().preset, [field]: padded } })).toThrow(/^GOAL_LAUNCH_DISCLOSURE_INVALID$/);
      }
      for (const field of ['requestId', 'sessionId']) {
        expect(() => parseGoalLaunchDecisionInput({ ...decision(), [field]: padded })).toThrow(/^GOAL_LAUNCH_DECISION_INVALID$/);
      }
    }
  });
  it('reads unknown-version envelope without reading payload getters', () => {
    const getter = vi.fn(() => { throw new Error('secret'); });
    const raw = Object.defineProperty({ schemaVersion: 2, disclosureId }, 'preset', { enumerable: true, get: getter });
    expect(parseGoalLaunchDisclosureEnvelope(raw)).toEqual({ schemaVersion: 2, disclosureId });
    expect(getter).not.toHaveBeenCalled();
    expect(() => parseGoalLaunchDisclosureV1(raw)).toThrow(/^GOAL_LAUNCH_DISCLOSURE_INVALID$/);
  });
  it('accepts plain null-prototype bodies and nested presets', () => {
    expect(parseGoalLaunchDisclosureV1(Object.assign(Object.create(null), disclosure(), { preset: Object.assign(Object.create(null), disclosure().preset) }))).toEqual(disclosure());
    expect(parseGoalLaunchDecisionInput(Object.assign(Object.create(null), decision()))).toEqual(decision());
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid envelope schemaVersion %s', schemaVersion => {
    expect(() => parseGoalLaunchDisclosureEnvelope({ schemaVersion, disclosureId })).toThrow(/^GOAL_LAUNCH_DISCLOSURE_ENVELOPE_INVALID$/);
  });
  it('accepts maximum positive safe schemaVersion', () => {
    expect(parseGoalLaunchDisclosureEnvelope({ schemaVersion: Number.MAX_SAFE_INTEGER, disclosureId })).toEqual({ schemaVersion: Number.MAX_SAFE_INTEGER, disclosureId });
  });
  it('ignores unknown-version payload members even when nonenumerable, symbolic or cyclic', () => {
    const raw: Record<string | symbol, unknown> = { schemaVersion: 99, disclosureId };
    raw.payload = raw; raw[Symbol('payload')] = undefined;
    Object.defineProperty(raw, 'goal', { get: () => { throw new Error('secret'); } });
    expect(parseGoalLaunchDisclosureEnvelope(raw)).toEqual({ schemaVersion: 99, disclosureId });
  });
  it('rejects inherited/nonenumerable envelope fields and sanitizes reflection errors', () => {
    expect(() => parseGoalLaunchDisclosureEnvelope(Object.create({ schemaVersion: 2, disclosureId }))).toThrow(/^GOAL_LAUNCH_DISCLOSURE_ENVELOPE_INVALID$/);
    expect(() => parseGoalLaunchDisclosureEnvelope(Object.defineProperty({ schemaVersion: 2 }, 'disclosureId', { value: disclosureId }))).toThrow(/^GOAL_LAUNCH_DISCLOSURE_ENVELOPE_INVALID$/);
    const hostile = new Proxy({}, { getPrototypeOf: () => { throw new Error('PRIVATE'); } });
    expect(() => parseGoalLaunchDisclosureEnvelope(hostile)).toThrow(/^GOAL_LAUNCH_DISCLOSURE_ENVELOPE_INVALID$/);
    expect(() => parseGoalLaunchDisclosureV1(hostile)).toThrow(/^GOAL_LAUNCH_DISCLOSURE_INVALID$/);
    expect(() => parseGoalLaunchDecisionInput(hostile)).toThrow(/^GOAL_LAUNCH_DECISION_INVALID$/);
  });
  it('preserves boundary goal whitespace and rejects over-limit preserved whitespace', () => {
    const goal = ` ${'x'.repeat(32766)} `;
    expect(parseGoalLaunchDisclosureV1({ ...disclosure(), goal }).goal).toBe(goal);
    expect(() => parseGoalLaunchDisclosureV1({ ...disclosure(), goal: goal+' ' })).toThrow(/^GOAL_LAUNCH_DISCLOSURE_INVALID$/);
    expect(() => parseGoalLaunchDecisionInput({ ...decision(), message: ' '.repeat(2001) })).toThrow(/^GOAL_LAUNCH_DECISION_INVALID$/);
    expect(Object.hasOwn(parseGoalLaunchDecisionInput(decision()), 'message')).toBe(false);
  });
  it.each(['', 'x'.repeat(20), 'x'.repeat(22), '!'.repeat(21), ' '+disclosureId, '😀'.repeat(21)])('rejects malformed exact disclosureId', id => {
    expect(() => parseGoalLaunchDisclosureEnvelope({ schemaVersion: 1, disclosureId: id })).toThrow(/^GOAL_LAUNCH_DISCLOSURE_ENVELOPE_INVALID$/);
    expect(() => parseGoalLaunchDecisionInput({ ...decision(), disclosureId: id })).toThrow(/^GOAL_LAUNCH_DECISION_INVALID$/);
  });
  it.each(['schemaVersion','kind','preset','goal','behavior','approvalBoundary','disclosureId'])('rejects missing disclosure %s', field => {
    const raw: Record<string, unknown> = disclosure(); delete raw[field];
    expect(() => parseGoalLaunchDisclosureV1(raw)).toThrow(/^GOAL_LAUNCH_DISCLOSURE_INVALID$/);
  });
  it.each(['requestId','sessionId','disclosureId','decision'])('rejects missing decision %s', field => {
    const raw: Record<string, unknown> = decision(); delete raw[field];
    expect(() => parseGoalLaunchDecisionInput(raw)).toThrow(/^GOAL_LAUNCH_DECISION_INVALID$/);
  });
  it('rejects extra string/symbol keys, nonenumerable fields, inherited fields and nonplain bodies', () => {
    for (const raw of [{ ...disclosure(), extra: true }, { ...disclosure(), [Symbol('extra')]: true },
      { ...disclosure(), preset: { ...disclosure().preset, extra: true } }, Object.create(disclosure()),
      Object.defineProperty(disclosure(), 'goal', { enumerable: false }), []]) {
      expect(() => parseGoalLaunchDisclosureV1(raw)).toThrow(/^GOAL_LAUNCH_DISCLOSURE_INVALID$/);
    }
    for (const raw of [{ ...decision(), extra: true }, { ...decision(), message: undefined }, new Date()]) {
      expect(() => parseGoalLaunchDecisionInput(raw)).toThrow(/^GOAL_LAUNCH_DECISION_INVALID$/);
    }
  });
  it('never invokes required or nested getters, including schemaVersion', () => {
    const getter = vi.fn(() => { throw new Error('SECRET'); });
    expect(() => parseGoalLaunchDisclosureEnvelope(Object.defineProperty({ disclosureId }, 'schemaVersion', { get: getter, enumerable: true }))).toThrow(/^GOAL_LAUNCH_DISCLOSURE_ENVELOPE_INVALID$/);
    expect(() => parseGoalLaunchDisclosureV1({ ...disclosure(), preset: Object.defineProperty({ id: 'p' }, 'name', { get: getter, enumerable: true }) })).toThrow(/^GOAL_LAUNCH_DISCLOSURE_INVALID$/);
    expect(() => parseGoalLaunchDecisionInput(Object.defineProperty(decision(), 'message', { get: getter, enumerable: true }))).toThrow(/^GOAL_LAUNCH_DECISION_INVALID$/);
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(['requestId','sessionId'])('counts astral codepoints for %s', field => {
    expect(parseGoalLaunchDecisionInput({ ...decision(), [field]: '😀'.repeat(512) })[field as 'requestId']).toBe('😀'.repeat(512));
    expect(() => parseGoalLaunchDecisionInput({ ...decision(), [field]: '😀'.repeat(513) })).toThrow(/^GOAL_LAUNCH_DECISION_INVALID$/);
  });
  it('counts astral limits for preset ID/name, goal and message', () => {
    expect(parseGoalLaunchDisclosureV1({ ...disclosure(), preset: { id: '😀'.repeat(512), name: '😀'.repeat(200) }, goal: '😀'.repeat(32768) }).goal).toHaveLength(65536);
    expect(parseGoalLaunchDecisionInput({ ...decision(), message: '😀'.repeat(2000) }).message).toHaveLength(4000);
    for (const patch of [{ goal: '😀'.repeat(32769) }, { preset: { id: 'x'.repeat(513), name: 'n' } }, { preset: { id: 'p', name: '😀'.repeat(201) } }]) {
      expect(() => parseGoalLaunchDisclosureV1({ ...disclosure(), ...patch })).toThrow(/^GOAL_LAUNCH_DISCLOSURE_INVALID$/);
    }
    expect(() => parseGoalLaunchDecisionInput({ ...decision(), message: '😀'.repeat(2001) })).toThrow(/^GOAL_LAUNCH_DECISION_INVALID$/);
  });
  it.each(['\uD800','\uDC00','a\uD800z'])('rejects lone UTF16 surrogates in all text fields', bad => {
    for (const patch of [{ goal: bad }, { preset: { id: bad, name: 'n' } }, { preset: { id: 'p', name: bad } }]) {
      expect(() => parseGoalLaunchDisclosureV1({ ...disclosure(), ...patch })).toThrow(/^GOAL_LAUNCH_DISCLOSURE_INVALID$/);
    }
    for (const field of ['requestId','sessionId','message']) expect(() => parseGoalLaunchDecisionInput({ ...decision(), [field]: bad })).toThrow(/^GOAL_LAUNCH_DECISION_INVALID$/);
  });
  it('rejects empty trimmed required text and wrong literal/types', () => {
    for (const patch of [{ goal: ' \n' }, { goal: 3 }, { schemaVersion: 2 }, { kind: 'other' }, { behavior: 'other' }, { approvalBoundary: 'other' }, { preset: { id: ' ', name: 'n' } }, { preset: { id: 'p', name: '' } }]) {
      expect(() => parseGoalLaunchDisclosureV1({ ...disclosure(), ...patch })).toThrow(/^GOAL_LAUNCH_DISCLOSURE_INVALID$/);
    }
    for (const patch of [{ requestId: '' }, { sessionId: ' ' }, { decision: 'auto' }, { message: null }]) expect(() => parseGoalLaunchDecisionInput({ ...decision(), ...patch })).toThrow(/^GOAL_LAUNCH_DECISION_INVALID$/);
  });
});

const hash = 'a'.repeat(64);
const goalLaunch = () => ({ schemaVersion: 1, parentWaitingRevision: 7, disclosureSha256: hash, argsSha256: hash,
  parentRunId: 'parent', parentSessionId: 'session', parentTurnId: 'turn', promptMessageId: 'prompt',
  assistantMessageId: 'assistant', flowDefinitionId: 'flow', schemaId: 'schema', policyId: 'policy',
  flowDefinitionSha256: hash, schemaDefinitionSha256: hash, policySha256: hash });
const requirement = () => ({ kind: 'human_only', toolName: 'run_sub_agentflow', callId: 'call', goalLaunch: goalLaunch() });
const origin = () => ({ schemaVersion: 1, kind: 'decision_browser_goal_launch', authorityMode: 'browser_cookie',
  requestId: 'request', sessionId: 'session', toolCallId: 'call', disclosureId, approvedFromRevision: 1 });
describe('goal launch host metadata shape parsers (not authority verification)', () => {
  it.each([undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER+1, '7'])('requires a real positive safe parentWaitingRevision %s', parentWaitingRevision => {
    expect(() => parseGoalLaunchHostRequirement({ ...requirement(), goalLaunch: { ...goalLaunch(), parentWaitingRevision } })).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
  });
  it('preserves the exact waiting revision without deriving it or accepting preparation-only input', () => {
    const raw = { ...requirement(), goalLaunch: { ...goalLaunch(), parentWaitingRevision: Number.MAX_SAFE_INTEGER } };
    expect(parseGoalLaunchHostRequirement(raw)).toEqual(raw);
    const preparing: Record<string, unknown> = goalLaunch(); delete preparing.parentWaitingRevision;
    expect(() => parseGoalLaunchHostRequirement({ ...requirement(), goalLaunch: preparing })).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
    expect(() => parseGoalLaunchHostRequirement({ ...requirement(), goalLaunch: { ...goalLaunch(), expectedWaitingRevision: 7 } })).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
  });
  it('rejects waiting revision getters without reading them', () => {
    const getter = vi.fn(() => { throw new Error('PRIVATE'); });
    const binding = Object.defineProperty(goalLaunch(), 'parentWaitingRevision', { get: getter, enumerable: true });
    expect(() => parseGoalLaunchHostRequirement({ ...requirement(), goalLaunch: binding })).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
    expect(getter).not.toHaveBeenCalled();
  });
  it('returns exact detached requirement and origin without asserting semantic hash/source validity', () => {
    const raw = requirement(); const parsed = parseGoalLaunchHostRequirement(raw);
    expect(parsed).toEqual(raw); expect(parsed).not.toBe(raw);
    expect(parseGoalLaunchBrowserDecisionOrigin(origin())).toEqual(origin());
  });
  it.each(Object.keys(requirement()))('rejects missing requirement outer %s', field => {
    const raw: Record<string, unknown> = requirement(); delete raw[field];
    expect(() => parseGoalLaunchHostRequirement(raw)).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
  });
  it.each(Object.keys(goalLaunch()))('rejects missing requirement binding %s', field => {
    const binding: Record<string, unknown> = goalLaunch(); delete binding[field];
    expect(() => parseGoalLaunchHostRequirement({ ...requirement(), goalLaunch: binding })).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
  });
  it.each(Object.keys(origin()))('rejects missing origin %s', field => {
    const raw: Record<string, unknown> = origin(); delete raw[field];
    expect(() => parseGoalLaunchBrowserDecisionOrigin(raw)).toThrow(/^GOAL_LAUNCH_APPROVAL_ORIGIN_INVALID$/);
  });
  it.each(['disclosureSha256','argsSha256','flowDefinitionSha256','schemaDefinitionSha256','policySha256'])('requires lowercase exact hash %s', field => {
    for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), ' '+hash, null]) {
      expect(() => parseGoalLaunchHostRequirement({ ...requirement(), goalLaunch: { ...goalLaunch(), [field]: bad } })).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
    }
  });
  it.each(['parentRunId','parentSessionId','parentTurnId','promptMessageId','assistantMessageId','flowDefinitionId','schemaId','policyId'])('requires exact scalar ID %s', field => {
    for (const bad of ['', ' x', 'x\u00A0', 'x\u2003', '\uD800', '\uDC00', '😀'.repeat(513), 1]) {
      expect(() => parseGoalLaunchHostRequirement({ ...requirement(), goalLaunch: { ...goalLaunch(), [field]: bad } })).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
    }
    const valid = { ...requirement(), goalLaunch: { ...goalLaunch(), [field]: '😀'.repeat(512) } };
    expect(parseGoalLaunchHostRequirement(valid)).toEqual(valid);
  });
  it.each(['requestId','sessionId','toolCallId'])('requires exact origin ID %s', field => {
    for (const bad of ['', '\tvalue', 'value\uFEFF', '\uD800', '😀'.repeat(513)]) {
      expect(() => parseGoalLaunchBrowserDecisionOrigin({ ...origin(), [field]: bad })).toThrow(/^GOAL_LAUNCH_APPROVAL_ORIGIN_INVALID$/);
    }
    const valid = { ...origin(), [field]: '😀'.repeat(512) };
    expect(parseGoalLaunchBrowserDecisionOrigin(valid)).toEqual(valid);
  });
  it('requires exact callId without trimming', () => {
    for (const callId of ['', '\u2003call', 'call ', '\uD800', '😀'.repeat(513)]) expect(() => parseGoalLaunchHostRequirement({ ...requirement(), callId })).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
    expect(parseGoalLaunchHostRequirement({ ...requirement(), callId: '😀'.repeat(512) })).toEqual({ ...requirement(), callId: '😀'.repeat(512) });
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER+1])('rejects invalid approved revision %s', approvedFromRevision => {
    expect(() => parseGoalLaunchBrowserDecisionOrigin({ ...origin(), approvedFromRevision })).toThrow(/^GOAL_LAUNCH_APPROVAL_ORIGIN_INVALID$/);
  });
  it('accepts maximum safe approved revision and rejects wrong versions/literals', () => {
    expect(parseGoalLaunchBrowserDecisionOrigin({ ...origin(), approvedFromRevision: Number.MAX_SAFE_INTEGER })).toEqual({ ...origin(), approvedFromRevision: Number.MAX_SAFE_INTEGER });
    for (const patch of [{ kind: 'auto' }, { toolName: 'terminal_spawn' }, { goalLaunch: { ...goalLaunch(), schemaVersion: 2 } }]) expect(() => parseGoalLaunchHostRequirement({ ...requirement(), ...patch })).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
    for (const patch of [{ schemaVersion: 2 }, { kind: 'manual' }, { authorityMode: 'telegram' }, { disclosureId: 'x'.repeat(20) }]) expect(() => parseGoalLaunchBrowserDecisionOrigin({ ...origin(), ...patch })).toThrow(/^GOAL_LAUNCH_APPROVAL_ORIGIN_INVALID$/);
  });
  it('rejects extras/symbols/inherited/nonenumerable/accessor fields without reading getters', () => {
    const getter = vi.fn(() => { throw new Error('SECRET'); });
    for (const raw of [{ ...requirement(), extra: true }, { ...requirement(), [Symbol('x')]: true },
      { ...requirement(), goalLaunch: { ...goalLaunch(), extra: true } }, Object.create(requirement()),
      Object.defineProperty(requirement(), 'callId', { enumerable: false }),
      Object.defineProperty(requirement(), 'goalLaunch', { get: getter }),
      { ...requirement(), goalLaunch: Object.defineProperty(goalLaunch(), 'policyId', { get: getter }) }]) {
      expect(() => parseGoalLaunchHostRequirement(raw)).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
    }
    for (const raw of [{ ...origin(), extra: true }, { ...origin(), [Symbol('x')]: true }, Object.create(origin()),
      Object.defineProperty(origin(), 'schemaVersion', { get: getter }), Object.defineProperty(origin(), 'sessionId', { enumerable: false })]) {
      expect(() => parseGoalLaunchBrowserDecisionOrigin(raw)).toThrow(/^GOAL_LAUNCH_APPROVAL_ORIGIN_INVALID$/);
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('accepts null prototypes and sanitizes reflection failures', () => {
    const raw = Object.assign(Object.create(null), requirement(), { goalLaunch: Object.assign(Object.create(null), goalLaunch()) });
    expect(parseGoalLaunchHostRequirement(raw)).toEqual(requirement());
    expect(parseGoalLaunchBrowserDecisionOrigin(Object.assign(Object.create(null), origin()))).toEqual(origin());
    const bad = new Proxy({}, { getPrototypeOf: () => { throw new Error('SECRET'); } });
    expect(() => parseGoalLaunchHostRequirement(bad)).toThrow(/^GOAL_LAUNCH_REQUIREMENT_INVALID$/);
    expect(() => parseGoalLaunchBrowserDecisionOrigin(bad)).toThrow(/^GOAL_LAUNCH_APPROVAL_ORIGIN_INVALID$/);
  });
});
