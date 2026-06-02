import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { RunJournalService } from './run-journal.service';

function makeService(): RunJournalService {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE chat_runs (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      safe_resume INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_heartbeat_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `);

  const drizzleService = new DrizzleService(null as never);
  (drizzleService as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
  return new RunJournalService(drizzleService);
}

describe('RunJournalService', () => {
  let service: RunJournalService;

  beforeEach(() => {
    service = makeService();
  });

  it('marks stale LLM runs as resumable after restart', async () => {
    const run = await service.startRun({
      sessionId: 's1',
      turnId: 't1',
      provider: 'openai',
      model: 'gpt-4.1-mini',
    });
    await service.checkpoint(run.id, { phase: 'llm_streaming' });

    await service.recoverStaleActiveRuns();

    await expect(service.getCurrentRun('s1')).resolves.toMatchObject({
      id: run.id,
      sessionId: 's1',
      turnId: 't1',
      phase: 'llm_streaming',
      status: 'interrupted_needs_retry',
      safeResume: true,
      errorCode: 'BACKEND_RESTART',
    });
  });

  it('marks stale tool runs as interrupted without safe resume', async () => {
    const run = await service.startRun({ sessionId: 's1', turnId: 't1' });
    await service.checkpoint(run.id, { phase: 'tool_running' });

    await service.recoverStaleActiveRuns();

    await expect(service.getCurrentRun('s1')).resolves.toMatchObject({
      status: 'interrupted_needs_retry',
      safeResume: false,
      errorMessage: 'Backend restarted while a tool was running. Retry manually to avoid duplicate tool execution.',
    });
  });

  it('returns null after a run completes', async () => {
    const run = await service.startRun({ sessionId: 's1', turnId: 't1' });
    await service.complete(run.id);

    await expect(service.getCurrentRun('s1')).resolves.toBeNull();
  });
});
