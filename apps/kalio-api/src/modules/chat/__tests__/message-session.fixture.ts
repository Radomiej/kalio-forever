import type { SqliteClient } from '../../../database/sqlite-runtime';

export function createMessageSessions(client: SqliteClient, ids: string[]): void {
  client.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY, persona_id TEXT NOT NULL DEFAULT 'persona', title TEXT NOT NULL DEFAULT 'Conversation',
    kind TEXT NOT NULL DEFAULT 'chat', parent_session_id TEXT, parent_turn_id TEXT, parent_tool_call_id TEXT,
    project_id TEXT NOT NULL DEFAULT 'system:none', execution_profile_id TEXT NOT NULL DEFAULT 'local-direct-default',
    external_thread_id TEXT, toolset_fingerprint TEXT, policy_fingerprint TEXT,
    runtime_binding_version INTEGER NOT NULL DEFAULT 1, runtime_context TEXT, archived_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT 100, updated_at INTEGER NOT NULL DEFAULT 100
  )`);
  for (const id of ids) client.prepare('INSERT INTO sessions (id) VALUES (?)').run(id);
}
