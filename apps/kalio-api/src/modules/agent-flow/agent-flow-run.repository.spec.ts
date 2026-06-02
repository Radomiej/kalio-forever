import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import type { AgentFlowRunSnapshot } from '@kalio/types';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { AgentFlowRunRepository } from './agent-flow-run.repository';

function snapshot(): AgentFlowRunSnapshot {
  return {
    run: {
      id: 'run-1',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-agentflow-1',
      childSessionId: 'child-1',
      flowDefinitionId: 'goal_guard_delivery_loop',
      status: 'running',
      startMode: 'durable',
      returnMode: 'summary',
      checkpoint: {
        goal: 'Build and verify',
        context: { source: 'test' },
        vfsMode: 'shared',
        copyBack: true,
        maxSteps: 12,
      },
      createdAt: 1,
      updatedAt: 2,
    },
    events: [
      {
        id: 'event-1',
        sequence: 1,
        type: 'flow:node_start',
        message: 'Start',
        createdAt: 2,
      },
    ],
    result: {
      flowRunId: 'run-1',
      childSessionId: 'child-1',
      status: 'done',
      summary: 'done',
      decisions: ['ready'],
      nextActions: [],
      artifacts: ['artifact.txt'],
      tracePreview: [
        {
          id: 'flow-event-1',
          sequence: 1,
          type: 'flow:node_done',
          message: 'done',
          createdAt: 2,
        },
      ],
    },
  };
}

describe('AgentFlowRunRepository', () => {
  it('stores and returns snapshots by id and parent session without leaking caller mutation', () => {
    const repo = new AgentFlowRunRepository();
    const stored = snapshot();

    repo.saveSnapshot(stored);
    stored.run.status = 'done';
    stored.events.push({
      id: 'event-2',
      sequence: 2,
      type: 'flow:mutated',
      message: 'should not leak',
      createdAt: 3,
    });
    stored.result?.decisions.push('bad');
    if (stored.run.checkpoint && typeof stored.run.checkpoint.context === 'object') {
      stored.run.checkpoint.context['source'] = 'mutated';
    }
    stored.result?.tracePreview?.push({
      id: 'flow-event-2',
      sequence: 2,
      type: 'flow:mutated',
      message: 'mutated',
      createdAt: 3,
    });

    const byRun = repo.getSnapshot('run-1');
    const byParent = repo.findByParentSessionId('parent-1');
    const all = repo.findAll();
    expect(byRun?.run.status).toBe('running');
    expect(byRun?.events).toHaveLength(1);
    expect(byRun?.result?.decisions).toEqual(['ready']);
    expect(byRun?.run.checkpoint?.goal).toBe('Build and verify');
    expect(byRun?.run.checkpoint?.context).toEqual({ source: 'test' });
    expect(byRun?.result?.tracePreview).toHaveLength(1);
    expect(byParent).toHaveLength(1);
    expect(byParent[0]?.run.id).toBe('run-1');
    expect(all).toHaveLength(1);
    expect(all[0]?.run.id).toBe('run-1');
  });

  it('updates stored runs while preserving prior event log entries', () => {
    const repo = new AgentFlowRunRepository();
    repo.saveSnapshot(snapshot());

    repo.upsertRun({
      id: 'run-1',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-agentflow-1',
      childSessionId: 'child-1',
      flowDefinitionId: 'goal_guard_delivery_loop',
      status: 'blocked',
      startMode: 'durable',
      returnMode: 'summary',
      createdAt: 1,
      updatedAt: 3,
    });
    const updated = repo.getSnapshot('run-1');

    expect(updated?.run.status).toBe('blocked');
    expect(updated?.run.updatedAt).toBe(3);
    expect(updated?.events).toHaveLength(1);
  });

  it('updates duplicate event ids instead of exposing duplicate trace rows before restart', () => {
    const repo = new AgentFlowRunRepository();
    repo.saveSnapshot(snapshot());

    repo.appendEvent('run-1', {
      id: 'event-1',
      sequence: 1,
      type: 'flow:node_start',
      message: 'Start updated after retry',
      createdAt: 4,
    });

    const updated = repo.getSnapshot('run-1');

    expect(updated?.events).toHaveLength(1);
    expect(updated?.events[0]).toMatchObject({
      id: 'event-1',
      message: 'Start updated after retry',
      createdAt: 4,
    });
  });

  it('deep clones checkpoint JSON so nested resume context cannot mutate stored runs', () => {
    const repo = new AgentFlowRunRepository();
    const stored = snapshot();
    stored.run.checkpoint = {
      ...stored.run.checkpoint!,
      resumeContext: { approval: { accepted: true } },
    };
    repo.saveSnapshot(stored);

    const firstRead = repo.getSnapshot('run-1');
    const resumeContext = firstRead?.run.checkpoint?.resumeContext;
    if (resumeContext && typeof resumeContext['approval'] === 'object' && resumeContext['approval'] !== null) {
      (resumeContext['approval'] as { accepted: boolean }).accepted = false;
    }

    expect(repo.getSnapshot('run-1')?.run.checkpoint?.resumeContext).toEqual({
      approval: { accepted: true },
    });
  });

  it('deep clones trace event payloads and result previews so audit evidence cannot be mutated after reads', () => {
    const repo = new AgentFlowRunRepository();
    const stored = snapshot();
    stored.events[0] = {
      ...stored.events[0]!,
      data: {
        childSessionIds: ['cli-child-1'],
        evidence: { files: ['src/App.tsx'] },
      },
      route: {
        source: 'router',
        fromNodeId: 'orchestrator',
        selectedNodeIds: ['implementer'],
        rejectedNodeIds: ['goal-guard'],
        nextNodeId: 'implementer',
      },
    };
    stored.result!.tracePreview![0] = {
      ...stored.result!.tracePreview![0]!,
      data: {
        childSessionIds: ['cli-child-1'],
        evidence: { files: ['src/App.tsx'] },
      },
    };
    repo.saveSnapshot(stored);

    const firstRead = repo.getSnapshot('run-1');
    const eventData = firstRead?.events[0]?.data as {
      childSessionIds: string[];
      evidence: { files: string[] };
    };
    const eventRoute = firstRead?.events[0]?.route;
    const previewData = firstRead?.result?.tracePreview?.[0]?.data as {
      childSessionIds: string[];
      evidence: { files: string[] };
    };

    eventData.childSessionIds.push('mutated-child');
    eventData.evidence.files.push('mutated.ts');
    eventRoute?.selectedNodeIds.push('mutated-node');
    previewData.childSessionIds.push('mutated-child');
    previewData.evidence.files.push('mutated.ts');

    const secondRead = repo.getSnapshot('run-1');
    expect(secondRead?.events[0]?.data).toEqual({
      childSessionIds: ['cli-child-1'],
      evidence: { files: ['src/App.tsx'] },
    });
    expect(secondRead?.events[0]?.route).toEqual({
      source: 'router',
      fromNodeId: 'orchestrator',
      selectedNodeIds: ['implementer'],
      rejectedNodeIds: ['goal-guard'],
      nextNodeId: 'implementer',
    });
    expect(secondRead?.result?.tracePreview?.[0]?.data).toEqual({
      childSessionIds: ['cli-child-1'],
      evidence: { files: ['src/App.tsx'] },
    });
  });

  it('returns undefined for missing snapshots', () => {
    const repo = new AgentFlowRunRepository();
    expect(repo.getSnapshot('missing')).toBeUndefined();
    expect(repo.findByParentSessionId('missing-parent')).toEqual([]);
  });

  it('reloads snapshots and event streams from durable storage', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema });
    sqlite.exec(`
      CREATE TABLE agent_flow_runs (
        id text PRIMARY KEY NOT NULL,
        parent_session_id text NOT NULL,
        parent_tool_call_id text,
        child_session_id text NOT NULL,
        open_chat_session_id text,
        open_graph_run_id text,
        flow_definition_id text NOT NULL,
        status text NOT NULL,
        start_mode text NOT NULL,
        return_mode text NOT NULL,
        waiting_for_node_id text,
        active_node_ids text,
        completed_node_ids text,
        active_phases text,
        completed_phases text,
        node_visit_counts text,
        max_iterations integer,
        return_to_orchestrator_count integer,
        checkpoint text,
        result text,
        summary text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        finished_at integer
      );
      CREATE TABLE agent_flow_events (
        id text PRIMARY KEY NOT NULL,
        run_id text NOT NULL,
        sequence integer NOT NULL,
        type text NOT NULL,
        status text,
        message text NOT NULL,
        event text NOT NULL,
        created_at integer NOT NULL
      );
    `);
    const drizzleService = { db } as unknown as DrizzleService;
    const repo = new AgentFlowRunRepository(drizzleService);
    repo.saveSnapshot(snapshot());

    const reloadedRepo = new AgentFlowRunRepository(drizzleService);
    const reloaded = reloadedRepo.getSnapshot('run-1');
    const byParent = reloadedRepo.findByParentSessionId('parent-1');
    const all = reloadedRepo.findAll();

    expect(reloaded?.run.id).toBe('run-1');
    expect(reloaded?.run.parentToolCallId).toBe('call-agentflow-1');
    expect(reloaded?.events).toHaveLength(1);
    expect(reloaded?.run.checkpoint?.goal).toBe('Build and verify');
    expect(reloaded?.result?.summary).toBe('done');
    expect(byParent).toHaveLength(1);
    expect(all).toHaveLength(1);
    expect(all[0]?.run.id).toBe('run-1');
    sqlite.close();
  });

  it('reloads durable run lifecycle fields needed by AgentFlow status APIs', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema });
    sqlite.exec(`
      CREATE TABLE agent_flow_runs (
        id text PRIMARY KEY NOT NULL,
        parent_session_id text NOT NULL,
        parent_tool_call_id text,
        child_session_id text NOT NULL,
        open_chat_session_id text,
        open_graph_run_id text,
        flow_definition_id text NOT NULL,
        status text NOT NULL,
        start_mode text NOT NULL,
        return_mode text NOT NULL,
        waiting_for_node_id text,
        active_node_ids text,
        completed_node_ids text,
        active_phases text,
        completed_phases text,
        node_visit_counts text,
        max_iterations integer,
        return_to_orchestrator_count integer,
        checkpoint text,
        result text,
        summary text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        finished_at integer
      );
      CREATE TABLE agent_flow_events (
        id text PRIMARY KEY NOT NULL,
        run_id text NOT NULL,
        sequence integer NOT NULL,
        type text NOT NULL,
        status text,
        message text NOT NULL,
        event text NOT NULL,
        created_at integer NOT NULL
      );
    `);
    const drizzleService = { db } as unknown as DrizzleService;
    const repo = new AgentFlowRunRepository(drizzleService);
    const stored = snapshot();
    stored.run = {
      ...stored.run,
      status: 'done',
      openChatSessionId: 'child-1',
      openGraphRunId: 'arch-run-1',
      maxIterations: 6,
      returnToOrchestratorCount: 2,
      summary: 'Goal Guard completed with verified evidence.',
      finishedAt: 9,
      updatedAt: 9,
    };
    repo.saveSnapshot(stored);

    const reloaded = new AgentFlowRunRepository(drizzleService).getSnapshot('run-1');

    expect(reloaded?.run).toMatchObject({
      openChatSessionId: 'child-1',
      openGraphRunId: 'arch-run-1',
      maxIterations: 6,
      returnToOrchestratorCount: 2,
      summary: 'Goal Guard completed with verified evidence.',
      finishedAt: 9,
    });
    sqlite.close();
  });
});
