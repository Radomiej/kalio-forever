import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { DrizzleService } from './drizzle.service';

describe('DrizzleService AgentFlow bootstrap repair', () => {
  it('backfills new agent_flow_runs columns on an existing older table', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE agent_flow_runs (
        id text PRIMARY KEY NOT NULL,
        parent_session_id text NOT NULL,
        child_session_id text NOT NULL,
        flow_definition_id text NOT NULL,
        status text NOT NULL,
        start_mode text NOT NULL,
        return_mode text NOT NULL,
        result text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      );
    `);
    const service = new DrizzleService(null as never);
    (service as unknown as { sqlite: Database.Database }).sqlite = sqlite;

    (service as unknown as { ensureAgentFlowTables: () => void }).ensureAgentFlowTables();

    const columns = sqlite.prepare('PRAGMA table_info(agent_flow_runs)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'open_chat_session_id',
      'parent_tool_call_id',
      'open_graph_run_id',
      'waiting_for_node_id',
      'active_node_ids',
      'completed_node_ids',
      'active_phases',
      'completed_phases',
      'node_visit_counts',
      'max_iterations',
      'return_to_orchestrator_count',
      'checkpoint',
      'summary',
      'finished_at',
    ]));
    sqlite.close();
  });
});
