import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import type { SessionsService } from '../chat/sessions.service';
import type { SessionManagerService } from '../chat/session-manager.service';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { ArchitectureRuntimeService } from './architecture-runtime.service';
import type { ArchitectureRunPreparationService } from './architecture-run-preparation.service';
import type { ArchitectureRuntimeAuditWriterService } from './architecture-runtime-audit.service';
import type { ArchitectureRuntimeChatProjectionService } from './architecture-runtime-chat-projection.service';
import type { ArchitectureAutoRoutingInput, ArchitectureAutoRoutingService } from './architecture-auto-routing.service';
import type { ArchitectureRuntimeAuditRecoveryService } from './architecture-runtime-audit-recovery.service';

function setup(options: { writeFailure?: boolean } = {}) {
  const base = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
  const schema: ArchitectureSchema = {
    ...base, id: 'jev-runtime-fixture', roleSlots: [],
    nodes: [
      { id: 'judge', kind: 'auto_router', label: 'Jev' },
      { id: 'worker', kind: 'artifact', label: 'Selected worker' },
      { id: 'attention', kind: 'artifact', label: 'Need attention' },
    ],
    edges: [
      { id: 'continue', fromNodeId: 'judge', toNodeId: 'worker', selection: 'choice' },
      { id: 'default', fromNodeId: 'judge', toNodeId: 'attention', selection: 'default' },
    ],
  };
  const run: ArchitectureRun = {
    id: 'jev-run', schemaId: schema.id, prompt: 'Build the approved home-site',
    context: { parentSessionId: 'parent' }, executionMode: 'session_branches',
    status: 'running', createdAt: 1, updatedAt: 1,
  };
  const decisions: ArchitectureExecutionEvent[] = [];
  const recovery = { reconstructRun: async () => null,
    reconstructEvents: vi.fn(async (): Promise<ArchitectureExecutionEvent[]> => []) };
  const writer = {
    logRun: vi.fn(), logEvent: vi.fn(), logFailure: vi.fn(), logHydration: vi.fn(),
    logRouteDecisionRequired: async (_schema: ArchitectureSchema, _run: ArchitectureRun, event: ArchitectureExecutionEvent) => {
      if (options.writeFailure) throw new Error('checkpoint unavailable');
      decisions.push(event);
    },
  };
  const choose = vi.fn(async (_input: ArchitectureAutoRoutingInput) => ({
    edgeId: 'continue', source: 'jev_choice' as const,
    confidence: 0.96, reason: 'confidence_met' as const,
  }));
  const service = new ArchitectureRuntimeService(
    new ArchitectureRegistryService(), {} as SessionsService, {} as SessionManagerService,
    { execute: async () => { throw new Error('Unexpected role execution'); } },
    undefined, undefined, undefined, undefined,
    { prepareRun: async () => ({ schema, run, hydration: null }) } as unknown as ArchitectureRunPreparationService,
    writer as unknown as ArchitectureRuntimeAuditWriterService,
    recovery as unknown as ArchitectureRuntimeAuditRecoveryService,
    { persistParent: async () => undefined, persistParentSafely: async () => undefined } as unknown as ArchitectureRuntimeChatProjectionService,
    undefined,
    { choose } as unknown as ArchitectureAutoRoutingService,
  );
  return { service, run, choose, decisions, writer, recovery };
}

describe('Jev runtime integration', () => {
  it('refuses goal resume without trusted route authority before executing or clearing cancellation', async () => {
    const { service, run } = setup();
    await service.createRun({ schemaId: run.schemaId, prompt: run.prompt });
    run.context = { ...run.context, goalProtocol: 1 };
    const stopped = await service.stopRun(run.id);
    await expect(service.resumeRun(run.id, {})).rejects.toThrow('GOAL_ROUTE_RESUME_UNAVAILABLE');
    expect(service.findRun(run.id)).toEqual(stopped);
    expect(stopped.status).toBe('cancelled');
  });
  it('retries required cancellation ACK through session Stop after execution drained', async () => {
    const { service, writer } = setup();
    const run = await service.createRun({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    run.context = { ...run.context, goalProtocol: 1 };
    const ack = vi.fn().mockRejectedValueOnce(new Error('cancel checkpoint unavailable'))
      .mockRejectedValueOnce(new Error('cancel checkpoint still unavailable')).mockResolvedValue(undefined);
    writer.logRouteDecisionRequired = ack;
    await expect(service.stopRun(run.id)).rejects.toThrow('cancel checkpoint unavailable');
    await expect(service.stopRunsForSessions(['parent'])).rejects.toThrow('cancel checkpoint still unavailable');
    await expect(service.stopRunsForSessions(['parent'])).resolves.toEqual([run.id]);
    expect(ack).toHaveBeenCalledTimes(3);
    expect(new Set(ack.mock.calls.map(call => call[3])).size).toBe(1);
    expect(service.getEvents(run.id).filter(event => event.type === 'run_stopped')).toHaveLength(1);
  });

  it('requires and retries the same goal cancellation ACK without another stop event', async () => {
    const { service, choose, writer } = setup();
    let entered!: () => void;
    const choosing = new Promise<void>(resolve => { entered = resolve; });
    choose.mockImplementationOnce((input: { signal?: AbortSignal }) => new Promise((_, reject) => {
      input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
      entered();
    }));
    const run = await service.createRunAsync({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    await choosing;
    run.context = { ...run.context, goalProtocol: 1 };
    const ack = vi.fn().mockRejectedValueOnce(new Error('cancel checkpoint unavailable')).mockResolvedValue(undefined);
    writer.logRouteDecisionRequired = ack;
    await expect(service.stopRun(run.id)).rejects.toThrow('cancel checkpoint unavailable');
    await service.stopRun(run.id);
    await service.stopRunsForSessions(['parent']);
    expect(ack).toHaveBeenCalledTimes(3);
    expect(ack.mock.calls[0]?.[3]).toBe(ack.mock.calls[1]?.[3]);
    expect(ack.mock.calls[0]?.[3]).toBe(ack.mock.calls[2]?.[3]);
    expect(service.getEvents(run.id).filter(event => event.type === 'run_stopped')).toHaveLength(1);
  });

  it('publishes one cancellation for concurrent Stop requests', async () => {
    const { service, choose } = setup();
    let entered!: () => void;
    const choosing = new Promise<void>(resolve => { entered = resolve; });
    choose.mockImplementationOnce((input: { signal?: AbortSignal }) => new Promise((_, reject) => {
      input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
      entered();
    }));
    const run = await service.createRunAsync({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    await choosing;
    await Promise.all([service.stopRun(run.id), service.stopRun(run.id)]);
    await service.stopRunsForSessions(['parent']);
    expect(service.getEvents(run.id).filter(event => event.type === 'run_stopped')).toHaveLength(1);
    expect(service.findRun(run.id)?.status).toBe('cancelled');
  });

  it('signals Stop before awaiting the durable run lookup', async () => {
    const { service, choose } = setup();
    let entered!: () => void;
    let release!: () => void;
    let activeSignal: AbortSignal | undefined;
    const choosing = new Promise<void>(resolve => { entered = resolve; });
    const lookup = new Promise<void>(resolve => { release = resolve; });
    choose.mockImplementationOnce((input: { signal?: AbortSignal }) => new Promise((_, reject) => {
      activeSignal = input.signal;
      input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
      entered();
    }));
    const run = await service.createRunAsync({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    await choosing;
    vi.spyOn(service, 'findRunDurable').mockImplementationOnce(async () => { await lookup; return run; });
    const stop = service.stopRun(run.id);
    try {
      expect(activeSignal?.aborted).toBe(true);
    } finally {
      release();
      await stop;
      await service.stopRunsForSessions(['parent']);
    }
    expect(service.findRun(run.id)?.status).toBe('cancelled');
    expect(service.getEvents(run.id).filter(event => event.type === 'node_started').map(event => event.nodeId))
      .toEqual(['judge']);
  });

  it('persists the selected edge and dispatches only that successor', async () => {
    const { service, choose, decisions } = setup();
    const result = await service.createRun({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    expect(result.status).toBe('completed');
    expect(choose).toHaveBeenCalledTimes(1);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.route).toMatchObject({ source: 'jev_choice', selectedEdgeId: 'continue' });
    expect(service.getEvents(result.id).filter((event) => event.type === 'node_started').map((event) => event.nodeId))
      .toEqual(['judge', 'worker']);
  });

  it('fails without dispatching either successor when checkpoint storage rejects', async () => {
    const { service } = setup({ writeFailure: true });
    const result = await service.createRun({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    expect(result.status).toBe('failed');
    expect(service.getEvents(result.id).filter((event) => event.type === 'node_started').map((event) => event.nodeId))
      .toEqual(['judge']);
  });

  it('aborts a waiting decision and drains the run without starting a successor', async () => {
    const { service, choose } = setup();
    let entered!: () => void;
    const choosing = new Promise<void>((resolve) => { entered = resolve; });
    choose.mockImplementationOnce((input: { signal?: AbortSignal }) => new Promise((_, reject) => {
      input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
      entered();
    }));
    const run = await service.createRunAsync({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    await choosing;
    await service.stopRunsForSessions(['parent']);
    expect(service.findRun(run.id)?.status).toBe('cancelled');
    expect(service.getEvents(run.id).filter((event) => event.type === 'node_started').map((event) => event.nodeId))
      .toEqual(['judge']);
    expect(service.getEvents(run.id).some((event) => event.type === 'run_stopped')).toBe(true);
  });

  it('rejects concurrent resume while the original execution is still choosing', async () => {
    const { service, choose } = setup();
    let entered!: () => void;
    const choosing = new Promise<void>((resolve) => { entered = resolve; });
    choose.mockImplementationOnce((input: { signal?: AbortSignal }) => new Promise((_, reject) => {
      input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
      entered();
    }));
    const run = await service.createRunAsync({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    await choosing;
    try {
      await expect(service.resumeRun(run.id, {})).rejects.toThrow('already executing');
      expect(choose).toHaveBeenCalledTimes(1);
    } finally {
      await service.stopRunsForSessions(['parent']);
    }
  });

  it('retains a checkpoint finishing after Stop but does not dispatch its successor', async () => {
    const { service, writer, decisions } = setup();
    let entered!: () => void;
    let release!: () => void;
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    writer.logRouteDecisionRequired = async (_schema, _run, event) => {
      const stored = structuredClone(event);
      entered();
      await barrier;
      decisions.push(stored);
    };
    const execution = service.createRun({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    await writing;
    await service.stopRun('jev-run');
    release();
    const run = await execution;
    expect(run.status).toBe('cancelled');
    expect(decisions).toHaveLength(1);
    const events = service.getEvents(run.id);
    expect(events.find((event) => event.id === decisions[0]?.id)).toEqual(decisions[0]);
    expect(decisions[0]!.sequence).toBeLessThan(events.find((event) => event.type === 'run_stopped')!.sequence);
    expect(service.getEvents(run.id).filter((event) => event.type === 'node_started').map((event) => event.nodeId))
      .toEqual(['judge']);
  });

  it('admits only one resume while durable history is being loaded', async () => {
    const { service, recovery } = setup();
    const run = await service.createRun({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    let entered!: () => void;
    let release!: () => void;
    const loading = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    recovery.reconstructEvents.mockImplementationOnce(async () => { entered(); await barrier; return []; });
    const first = service.resumeRun(run.id, {});
    await loading;
    try {
      await expect(service.resumeRun(run.id, {})).rejects.toThrow('already executing');
    } finally {
      release();
      await first;
    }
  });

  it('does not revive a run stopped while resume history is loading', async () => {
    const { service, recovery, choose } = setup();
    const run = await service.createRun({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    let entered!: () => void;
    let release!: () => void;
    const loading = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    recovery.reconstructEvents.mockImplementationOnce(async () => { entered(); await barrier; return []; });
    const resume = service.resumeRun(run.id, {});
    const rejected = expect(resume).rejects.toThrow('GOAL_RESUME_ABORTED');
    await loading;
    await service.stopRun(run.id);
    release();
    await rejected;
    expect(service.findRun(run.id)?.status).toBe('cancelled');
    expect(choose).toHaveBeenCalledTimes(1);
  });

  it('both Stop drain calls await a cancelled run whose checkpoint write is still active', async () => {
    const { service, writer } = setup();
    let entered!: () => void;
    let release!: () => void;
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    writer.logRouteDecisionRequired = async () => { entered(); await barrier; };
    const run = await service.createRunAsync({ schemaId: 'jev-runtime-fixture', prompt: 'Build home-site' });
    await writing;
    await service.stopRun(run.id);
    let firstDone = false;
    let secondDone = false;
    const first = service.stopRunsForSessions(['parent']).then(() => { firstDone = true; });
    const second = service.stopRunsForSessions(['parent']).then(() => { secondDone = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(firstDone).toBe(false);
    expect(secondDone).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(service.findRun(run.id)?.status).toBe('cancelled');
    expect(service.getEvents(run.id).filter((event) => event.type === 'run_stopped')).toHaveLength(1);
  });
});
