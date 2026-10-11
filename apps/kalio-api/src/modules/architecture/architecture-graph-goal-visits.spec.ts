import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureSchema } from '@kalio/types';
import { ArchitectureGraphContext } from './architecture-graph-runtime.context';
import { createGoalPacket } from './architecture-goal-source';
import { acknowledgeGoalVisit, prepareGoalVisit, type GoalVisitInput } from './architecture-graph-goal-visits';

function fixture() {
  const packet = createGoalPacket({ sessionId: 'host', messageId: 'prompt', turnId: 'turn', content: 'Goal', createdAt: 1 });
  const node = { id: 'worker', label: 'Worker', kind: 'role' as const, roleSlotId: 'worker' };
  const schema: ArchitectureSchema = { id: 'schema', name: 'Schema', description: '', version: '1', nodes: [node], edges: [],
    roleSlots: [], routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
    contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true }, outputArtifactSchema: 'goal' };
  const persist = vi.fn<(input: GoalVisitInput) => Promise<void>>(async () => undefined);
  const ctx = new ArchitectureGraphContext({ schema, now: 1, personaForSlot: () => 'worker', roleExecutor: { execute: vi.fn() },
    persistGoalVisit: persist, run: { id: 'run', schemaId: 'schema', rootSessionId: 'root', prompt: 'Goal', goalPacket: packet,
      executionMode: 'subagent_execution', context: { goalProtocol: 1 }, branchSessionIds: { worker: 'branch' }, status: 'running', createdAt: 1, updatedAt: 1 } });
  ctx.goalDirective = { kind: 'proposal', state: { runId: 'run', rootSessionId: 'root', stateRevision: 1, packet,
    evidenceInventory: null, completionAuthorization: null, createdAt: 1, updatedAt: 1 } };
  const event = ctx.createEvent('node_started', 'Started', { nodeId: node.id, roleSlotId: node.roleSlotId });
  return { ctx, node, event, persist };
}

describe('required goal visit ACK', () => {
  it('uses scheduler count 20 for fresh visit 21 with partial history', () => {
    const f = fixture();
    f.ctx.options.resumeFrom = { reason: 'runtime_recovery', pendingNodeIds: ['worker'], visitCounts: { worker: 20 } };
    f.ctx.seedPriorEvents();
    const prepared = prepareGoalVisit(f.ctx, f.node, f.event, f.event.id, false);
    expect(prepared.visit).toBe(21); expect(prepared.event.data?.['goalVisit']).toBe(21);
    expect(f.event.data).toBeUndefined();
  });
  it('replays persisted start ordinal, not cursor count which already includes that visit', () => {
    const f = fixture(); f.event.data = { goalVisit: 21 }; f.ctx.appendEvent(f.event);
    f.ctx.nodeVisitCounts.set(f.node.id, 21);
    expect(prepareGoalVisit(f.ctx, f.node, f.event, f.event.id, true).visit).toBe(21);
  });
  it('rejects replay without exact persisted ordinal instead of guessing from cursor', () => {
    const f = fixture(); f.ctx.appendEvent(f.event); f.ctx.nodeVisitCounts.set(f.node.id, 20);
    expect(() => prepareGoalVisit(f.ctx, f.node, f.event, f.event.id, true)).toThrow('Goal graph visit failed.');
  });
  it('completion uses persisted 21 even when cursor already counts unfinished visit 21', () => {
    const f = fixture(); f.event.data = { goalVisit: 21 }; f.ctx.appendEvent(f.event);
    f.ctx.nodeVisitCounts.set(f.node.id, 21);
    const completed = f.ctx.createEvent('node_completed', 'Done', { nodeId: f.node.id, roleSlotId: f.node.roleSlotId });
    expect(prepareGoalVisit(f.ctx, f.node, completed, f.event.id, false).visit).toBe(21);
  });
  it.each([0, -1, 1.5, Infinity, '21'])('rejects invalid persisted replay ordinal %s', visit => {
    const f = fixture(); f.event.data = { goalVisit: visit }; f.ctx.appendEvent(f.event);
    expect(() => prepareGoalVisit(f.ctx, f.node, f.event, f.event.id, true)).toThrow('Goal graph visit failed.');
  });
  it('does not append start before ACK and passes detached exact identity', async () => {
    const f = fixture(); let release!: () => void;
    f.persist.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const pending = acknowledgeGoalVisit(f.ctx, f.node, f.event, f.event.id, false);
    expect(f.ctx.events).toEqual([]);
    expect(f.persist.mock.calls[0]?.[0]).toMatchObject({ visit: 1, branchSessionId: 'branch', rootSessionId: 'root', startedEventId: f.event.id });
    release(); expect(await pending).toBe(true); expect(f.ctx.events).toEqual([{ ...f.event, data: { goalVisit: 1 } }]);
  });
  it('fails closed without the hook', async () => {
    const f = fixture(); delete f.ctx.options.persistGoalVisit;
    await expect(acknowledgeGoalVisit(f.ctx, f.node, f.event, f.event.id, false)).rejects.toThrow('Goal graph visit failed.');
    expect(f.ctx.events).toEqual([]);
  });
  it('sanitizes hook rejection without appending', async () => {
    const f = fixture(); f.persist.mockRejectedValue(new Error('SECRET'));
    await expect(acknowledgeGoalVisit(f.ctx, f.node, f.event, f.event.id, false)).rejects.toThrow('Goal graph visit failed.');
    expect(f.ctx.events).toEqual([]);
  });
  it.each(['stop', 'abort', 'state'] as const)('blocks publication after %s during ACK', async mode => {
    const f = fixture(); const controller = new AbortController(); f.ctx.options.signal = controller.signal;
    f.persist.mockImplementation(async () => {
      if (mode === 'stop') f.ctx.options.run.status = 'cancelled';
      if (mode === 'abort') controller.abort('SECRET');
      if (mode === 'state') f.ctx.goalDirective!.state.stateRevision++;
    });
    const pending = acknowledgeGoalVisit(f.ctx, f.node, f.event, f.event.id, false);
    if (mode === 'state') await expect(pending).rejects.toThrow('Goal graph visit failed.');
    else expect(await pending).toBe(false);
    expect(f.ctx.events).toEqual([]);
  });
  it('replays the exact start without a duplicate local append', async () => {
    const f = fixture(); f.event.data = { goalVisit: 1 }; f.ctx.appendEvent(f.event);
    expect(await acknowledgeGoalVisit(f.ctx, f.node, f.event, f.event.id, true)).toBe(true);
    expect(f.ctx.events).toHaveLength(1);
    expect(f.persist.mock.calls[0]?.[0]).toMatchObject({ replay: true, event: f.event });
  });
  it('completion retains start identity and existing route before ACK', async () => {
    const f = fixture(); f.event.data = { goalVisit: 1 }; f.ctx.appendEvent(f.event);
    const route = f.ctx.createEvent('router_decision', 'Route', { nodeId: f.node.id }); f.ctx.appendEvent(route);
    const completed = f.ctx.createEvent('node_completed', 'Done', { nodeId: f.node.id, roleSlotId: f.node.roleSlotId, data: { selectedNodeIds: ['judge'] } });
    const input = prepareGoalVisit(f.ctx, f.node, completed, f.event.id, false);
    expect(input.startedEventId).toBe(f.event.id); expect(input.visit).toBe(1);
    await acknowledgeGoalVisit(f.ctx, f.node, completed, f.event.id, false);
    expect(f.ctx.events.map(event => event.type)).toEqual(['node_started', 'router_decision', 'node_completed']);
  });
});
