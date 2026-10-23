import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureSchema } from '@kalio/types';
import { decodeGoalRouteAuthorityRecord, decodeGoalRouteAuthorityRecords,
  type GoalRouteAuthorityLeafV1, type GoalRouteAuthorityContext, type GoalRouteAdmissionV1, type GoalRouteVisitV1 } from './architecture-goal-route-authority-record';

const hash = 'a'.repeat(64);
const ref = (id: string, label = 'architecture_event:goal_route_visit') => ({ id, label, expectedDataSha256: hash });
const schema: ArchitectureSchema = { id: 'schema', name: 'Fixture', description: '', version: '1',
  roleSlots: [{ id: 'worker-slot', label: 'Worker', description: '', slotType: 'participant', defaultPersonaId: 'worker', allowedPersonaTags: [], required: true, canOverrideAtRunStart: false }],
  nodes: [{ id: 'worker', label: 'Worker', kind: 'role', roleSlotId: 'worker-slot' }, { id: 'end', label: 'End', kind: 'artifact' }], edges: [],
  routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
  contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
  memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true }, outputArtifactSchema: 'fixture' };
const context: GoalRouteAuthorityContext = { schema,
  run: { id: 'run', rootSessionId: 'internal-root', schemaId: 'schema', branchSessionIds: { 'worker-slot': 'branch' } } };
const base = () => ({ schemaVersion: 1 as const, goalProtocol: true as const, runId: 'run', rootSessionId: 'internal-root', schemaId: 'schema',
  sequence: 1, binding: { stateRevision: 1, sourceVersion: 1, sourceFingerprint: hash }, nodeId: 'worker', visit: 1, branchSessionId: 'branch' });
function launch(): GoalRouteAdmissionV1 { return { ...base(), recordType: 'goal_route_admission', admissionKind: 'launch',
  authorizationRef: ref('dispatcher-origin', 'architecture_event:goal_launch_authorization'), predecessorAdmissionRef: null, stopRef: null, entryRouteRef: null }; }
const admissionRef = () => ref('launch', 'architecture_event:goal_route_admission');
function started(): GoalRouteVisitV1 { return { ...base(), recordType: 'goal_route_visit', sequence: 2, admissionRef: admissionRef(), eventId: 'actual-start',
  transition: 'started', predecessorVisitRef: null, startedRef: null, routeRef: null }; }
function completed(): GoalRouteVisitV1 { return { ...base(), recordType: 'goal_route_visit', sequence: 4, admissionRef: admissionRef(), eventId: 'actual-completed',
  transition: 'completed', predecessorVisitRef: ref('started'), startedRef: ref('started'), routeRef: ref('opaque-route', 'architecture_event:router_decision:worker') }; }
function readmission(): GoalRouteAdmissionV1 { return { ...base(), recordType: 'goal_route_admission', sequence: 5, admissionKind: 'readmission',
  authorizationRef: ref('actual-resume-authorization', 'architecture_event:goal_resume_authorization'), predecessorAdmissionRef: admissionRef(),
  stopRef: ref('actual-stop', 'architecture_event:run_stopped:runtime'), entryRouteRef: ref('actual-route', 'architecture_event:router_decision:worker') }; }
function leaves(): GoalRouteAuthorityLeafV1[] { return [{ proof: admissionRef(), record: launch() }, { proof: ref('started'), record: started() }, { proof: ref('completed'), record: completed() }]; }

describe('strict local goal route authority records (structure only)', () => {
  it.each(['launch', 'readmission', 'started', 'completed'])('decodes exact %s shape without assigning authority', kind => {
    const raw = kind === 'launch' ? launch() : kind === 'readmission' ? readmission() : kind === 'started' ? started() : completed();
    expect(decodeGoalRouteAuthorityRecord(raw, context)).toEqual(raw);
    expect(decodeGoalRouteAuthorityRecord(raw, context)).not.toHaveProperty('authorized');
  });
  it('decodes a complete unsorted admission/visit closure with unique sequences', () => {
    const raw = leaves().reverse(); const decoded = decodeGoalRouteAuthorityRecords(raw, context);
    expect(decoded.map(leaf => leaf.record.sequence)).toEqual([4, 2, 1]);
  });
  it.each(['version', 'marker', 'run', 'root', 'schema', 'sequence', 'source', 'revision', 'extra', 'node', 'visit', 'branch', 'null-branch', 'missing-authorization'])('rejects invalid %s without raw content', kind => {
    const raw = launch();
    if (kind === 'version') Reflect.set(raw, 'schemaVersion', 2); if (kind === 'marker') Reflect.set(raw, 'goalProtocol', false);
    if (kind === 'run') raw.runId = 'foreign'; if (kind === 'root') raw.rootSessionId = 'HOST'; if (kind === 'schema') raw.schemaId = 'other';
    if (kind === 'sequence') raw.sequence = Infinity; if (kind === 'source') raw.binding.sourceFingerprint = 'PRIVATE';
    if (kind === 'revision') raw.binding.stateRevision = 0; if (kind === 'extra') Reflect.set(raw, 'accepted', true);
    if (kind === 'node') raw.nodeId = 'foreign'; if (kind === 'visit') raw.visit = .5; if (kind === 'branch') raw.branchSessionId = 'foreign';
    if (kind === 'null-branch') raw.branchSessionId = null; if (kind === 'missing-authorization') Reflect.deleteProperty(raw, 'authorizationRef');
    expect(() => decodeGoalRouteAuthorityRecord(raw, context)).toThrow(/^GOAL_ROUTE_AUTHORITY_RECORD_INVALID$/);
  });
  it.each(['empty-id', 'empty-label', 'uppercase-sha', 'short-sha', 'extra', 'missing-sha'])('rejects malformed proof ref %s', kind => {
    const raw = launch(); const proof = raw.authorizationRef;
    if (kind === 'empty-id') proof.id = ''; if (kind === 'empty-label') proof.label = ''; if (kind === 'uppercase-sha') proof.expectedDataSha256 = 'A'.repeat(64);
    if (kind === 'short-sha') proof.expectedDataSha256 = 'a'.repeat(63); if (kind === 'extra') Reflect.set(proof, 'runId', 'foreign');
    if (kind === 'missing-sha') Reflect.deleteProperty(proof, 'expectedDataSha256');
    expect(() => decodeGoalRouteAuthorityRecord(raw, context)).toThrow(/^GOAL_ROUTE_AUTHORITY_RECORD_INVALID$/);
  });
  it.each(['launch-predecessor', 'launch-stop', 'launch-entry', 'readmission-predecessor', 'readmission-entry', 'start-route', 'start-started', 'complete-route', 'complete-started', 'complete-predecessor'])('rejects mismatched variant %s', kind => {
    const raw = kind.startsWith('readmission') ? readmission() : kind.startsWith('start-') ? started() : kind.startsWith('complete-') ? completed() : launch();
    if (kind === 'launch-predecessor') Reflect.set(raw, 'predecessorAdmissionRef', admissionRef());
    if (kind === 'launch-stop') Reflect.set(raw, 'stopRef', ref('stop')); if (kind === 'launch-entry') Reflect.set(raw, 'entryRouteRef', ref('route'));
    if (kind === 'readmission-predecessor') Reflect.set(raw, 'predecessorAdmissionRef', null); if (kind === 'readmission-entry') Reflect.set(raw, 'entryRouteRef', null);
    if (kind === 'start-route') Reflect.set(raw, 'routeRef', ref('route')); if (kind === 'start-started') Reflect.set(raw, 'startedRef', ref('start'));
    if (kind === 'complete-route') Reflect.set(raw, 'routeRef', null); if (kind === 'complete-started') Reflect.set(raw, 'startedRef', null);
    if (kind === 'complete-predecessor') Reflect.set(raw, 'predecessorVisitRef', ref('different'));
    expect(() => decodeGoalRouteAuthorityRecord(raw, context)).toThrow(/^GOAL_ROUTE_AUTHORITY_RECORD_INVALID$/);
  });
  it('allows a host-only artifact null branch but not a role-backed artifact', () => {
    const raw = launch(); raw.nodeId = 'end'; raw.branchSessionId = null;
    expect(decodeGoalRouteAuthorityRecord(raw, context).branchSessionId).toBeNull();
    const copied = structuredClone(context); copied.schema.nodes[1]!.roleSlotId = 'worker-slot';
    expect(() => decodeGoalRouteAuthorityRecord(raw, copied)).toThrow(/^GOAL_ROUTE_AUTHORITY_RECORD_INVALID$/);
  });
  it('readmission may have null Stop only when the future reader proves no intervening Stop', () => {
    const raw = readmission(); raw.stopRef = null; expect(decodeGoalRouteAuthorityRecord(raw, context)).toEqual(raw);
  });
  it.each(['raw', 'binding', 'ref', 'context'])('rejects %s getter without invocation', location => {
    const raw = launch(); const copied = structuredClone(context); const getter = vi.fn(() => 'PRIVATE');
    const target = location === 'raw' ? raw : location === 'binding' ? raw.binding : location === 'ref' ? raw.authorizationRef : copied.run;
    const key = location === 'raw' ? 'nodeId' : location === 'binding' ? 'sourceFingerprint' : location === 'ref' ? 'id' : 'rootSessionId';
    Object.defineProperty(target, key, { enumerable: true, get: getter });
    expect(() => decodeGoalRouteAuthorityRecord(raw, copied)).toThrow(/^GOAL_ROUTE_AUTHORITY_RECORD_INVALID$/); expect(getter).not.toHaveBeenCalled();
  });
  it('rejects proxy records without invoking traps', () => {
    const trap = vi.fn(() => { throw new Error('PRIVATE'); }); const raw = new Proxy(launch(), { ownKeys: trap });
    expect(() => decodeGoalRouteAuthorityRecord(raw, context)).toThrow(/^GOAL_ROUTE_AUTHORITY_RECORD_INVALID$/); expect(trap).not.toHaveBeenCalled();
  });
  it.each(['duplicate-id', 'duplicate-sequence', 'missing-admission', 'foreign-hash', 'cycle', 'future-start', 'wrong-node', 'wrong-visit', 'readmission-null-predecessor'])('rejects malformed closure %s', kind => {
    const raw = leaves();
    if (kind === 'duplicate-id') raw[1]!.proof.id = 'launch'; if (kind === 'duplicate-sequence') raw[1]!.record.sequence = 1;
    if (kind === 'missing-admission') raw.shift(); if (kind === 'foreign-hash') raw[0]!.proof.expectedDataSha256 = 'f'.repeat(64);
    if (kind === 'cycle') Reflect.set(raw[1]!.record, 'predecessorVisitRef', ref('completed'));
    if (kind === 'future-start') raw[1]!.record.sequence = 9; if (kind === 'wrong-node') { raw[2]!.record.nodeId = 'end'; raw[2]!.record.branchSessionId = null; }
    if (kind === 'wrong-visit') raw[2]!.record.visit = 2;
    if (kind === 'readmission-null-predecessor') {
      raw.push({ proof: ref('readmitted', 'architecture_event:goal_route_admission'), record: readmission() });
      raw.push({ proof: ref('new-start'), record: { ...started(), sequence: 6, admissionRef: ref('readmitted', 'architecture_event:goal_route_admission') } });
    }
    expect(() => decodeGoalRouteAuthorityRecords(raw, context)).toThrow(/^GOAL_ROUTE_AUTHORITY_RECORD_INVALID$/);
  });
  it('detaches records, refs and binding from input', () => {
    const raw = launch(); const decoded = decodeGoalRouteAuthorityRecord(raw, context);
    decoded.binding.stateRevision = 99;
    if (decoded.recordType !== 'goal_route_admission') throw new Error('fixture'); decoded.authorizationRef.id = 'changed';
    expect(raw.binding.stateRevision).toBe(1); expect(raw.authorizationRef.id).toBe('dispatcher-origin');
  });
  it.each(['repeated-entry', 'duplicate-event', 'double-completion', 'second-launch', 'start-after-start'])('rejects contradictory chain %s', kind => {
    const raw = leaves();
    if (kind === 'second-launch') raw.push({ proof: ref('other-launch', 'architecture_event:goal_route_admission'), record: { ...launch(), sequence: 5 } });
    else if (kind === 'double-completion') raw.push({ proof: ref('other-completion'), record: { ...completed(), sequence: 5, eventId: 'other-completion' } });
    else {
      const row = started(); if (row.transition !== 'started') throw new Error('fixture');
      raw.push({ proof: ref('other-start'), record: { ...row, sequence: 5,
        eventId: kind === 'duplicate-event' ? 'actual-start' : 'other-start',
        predecessorVisitRef: kind === 'start-after-start' ? ref('started') : null } });
    }
    expect(() => decodeGoalRouteAuthorityRecords(raw, context)).toThrow(/^GOAL_ROUTE_AUTHORITY_RECORD_INVALID$/);
  });
  it('allows an explicit continued visit and a readmitted interrupted visit', () => {
    const continued = { ...started(), sequence: 5, visit: 2, eventId: 'continued', predecessorVisitRef: ref('completed') };
    expect(decodeGoalRouteAuthorityRecords([...leaves(), { proof: ref('continued'), record: continued }], context)).toHaveLength(4);
    const resumed = { ...started(), sequence: 6, eventId: 'resumed', admissionRef: ref('readmitted', 'architecture_event:goal_route_admission'), predecessorVisitRef: ref('started') };
    expect(decodeGoalRouteAuthorityRecords([leaves()[0], leaves()[1],
      { proof: ref('readmitted', 'architecture_event:goal_route_admission'), record: readmission() },
      { proof: ref('resumed'), record: resumed }], context)).toHaveLength(4);
  });
});
