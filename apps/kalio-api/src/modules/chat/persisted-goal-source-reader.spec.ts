import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { PersistedGoalSourceReader } from './persisted-goal-source-reader';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));
const locator = { sessionId: 'source-chat', messageId: 'prompt', turnId: 'turn' };
function fixture(role = 'user', content = '  Secret canonical\ngoal  ') {
  const client = new Database(':memory:');
  clients.push(client);
  client.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)');
  client.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run('prompt', 'source-chat', 'turn', role, content, 1234);
  const dependency = { db: drizzle(client, { schema }) } as unknown as DrizzleService;
  return { reader: new PersistedGoalSourceReader(dependency), client };
}

describe('PersistedGoalSourceReader real SQLite', () => {
  it('selects only exact canonical persisted fields verbatim', async () => {
    const { reader } = fixture();
    await expect(reader.read(locator)).resolves.toEqual({ ...locator, content: '  Secret canonical\ngoal  ', createdAt: 1234 });
  });
  it.each([{ messageId: 'absent' }, { sessionId: 'wrong' }, { turnId: 'wrong' }])('returns null for no exact match (%j)', async patch => {
    await expect(fixture().reader.read({ ...locator, ...patch })).resolves.toBeNull();
  });
  it.each(['assistant', 'system', 'tool_result'])('does not admit %s content', async role => {
    await expect(fixture(role).reader.read(locator)).resolves.toBeNull();
  });
  it('rejects invalid IDs and malformed persisted user content with static errors', async () => {
    const { reader } = fixture('user', ' \n ');
    await expect(reader.read(locator)).rejects.toThrow(/^GOAL_SOURCE_INVALID\.$/);
    await expect(reader.read({ ...locator, turnId: '' })).rejects.toThrow(/^GOAL_SOURCE_INVALID\.$/);
  });
  it('sanitizes storage errors', async () => {
    const { reader, client } = fixture();
    client.exec('DROP TABLE messages');
    await expect(reader.read(locator)).rejects.toThrow(/^GOAL_SOURCE_STORAGE_ERROR\.$/);
  });
});
