import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { HitlRequestService } from './hitl-request.service';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));
function fixture() {
  const client = new Database(':memory:'); clients.push(client);
  client.exec(`CREATE TABLE hitl_requests (id TEXT PRIMARY KEY,kind TEXT,status TEXT,session_id TEXT,turn_id TEXT,run_id TEXT,tool_call_id TEXT,
    payload TEXT,continuation TEXT,outcome TEXT,revision INTEGER,created_at INTEGER,updated_at INTEGER,resolved_at INTEGER);`);
  const service = new HitlRequestService({ db: drizzle(client, { schema }) } as unknown as DrizzleService);
  const insert = (id: string, requirement: unknown, present = true) => {
    client.prepare('INSERT INTO hitl_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, 'tool_confirmation', 'pending', 'session', 'turn', 'run', 'call-'+id,
      JSON.stringify({ toolName: id === 'terminal' ? 'terminal_spawn' : 'run_sub_agentflow', args: {} }),
      JSON.stringify({ ...(present ? { hostConfirmationRequirement: requirement } : {}), promptMessageId: 'prompt' }), null, 1, 100, 100, null);
  };
  return { client, service, insert };
}
it('hides preparing/final/malformed protected goal rows but preserves raw pending for Stop', async () => {
  const { service, insert } = fixture();
  insert('preparing', { kind: 'human_only', toolName: 'run_sub_agentflow', callId: 'call', goalLaunch: {} });
  insert('final', { kind: 'human_only', toolName: 'run_sub_agentflow', callId: 'call', goalLaunch: { parentWaitingRevision: 7 } });
  insert('malformed', { kind: 'bad', toolName: 'wrong', goalLaunch: null });
  insert('name-only', { toolName: 'run_sub_agentflow' });
  insert('terminal', { kind: 'human_only', toolName: 'terminal_spawn', callId: 'call-terminal' });
  insert('legacy', undefined, false);
  expect((await service.listPendingToolConfirmations('session')).map(row => row.requestId)).toEqual(['terminal', 'legacy']);
  expect((await service.listPending('session')).map(row => row.id)).toEqual(['preparing', 'final', 'malformed', 'name-only', 'terminal', 'legacy']);
});
it.each([null, [], 'bad', 1])('fails closed for malformed own private marker %j', async marker => {
  const { service, insert } = fixture(); insert('malformed', marker);
  expect(await service.listPendingToolConfirmations('session')).toEqual([]);
  expect(await service.listPending('session')).toHaveLength(1);
});
it('does not read accessors in the private marker', async () => {
  const { service, insert } = fixture(); insert('row', {}, false);
  const rows = await service.listPending('session'); const row = rows[0]!;
  const getter = vi.fn(() => { throw new Error('SECRET'); });
  row.continuation = Object.defineProperty({}, 'hostConfirmationRequirement', { get: getter, enumerable: true });
  vi.spyOn(service, 'listPending').mockResolvedValue(rows);
  expect(await service.listPendingToolConfirmations('session')).toEqual([]);
  expect(getter).not.toHaveBeenCalled();
});
it('recognizes goal marker despite payload name drift without broadly hiding terminal host markers', async () => {
  const { service, insert, client } = fixture();
  insert('goal-drift', { goalLaunch: null });
  client.prepare("UPDATE hitl_requests SET payload=? WHERE id='goal-drift'").run(JSON.stringify({ toolName: 'terminal_spawn', args: {} }));
  insert('terminal', { kind: 'human_only', toolName: 'terminal_spawn', callId: 'call-terminal' });
  expect((await service.listPendingToolConfirmations('session')).map(row => row.requestId)).toEqual(['terminal']);
  expect(await service.listPending('session')).toHaveLength(2);
});
it('does not read nested goal marker accessors', async () => {
  const { service, insert } = fixture(); insert('row', {}, false);
  const rows = await service.listPending('session'); const getter = vi.fn(() => { throw new Error('SECRET'); });
  rows[0]!.payload = { toolName: 'terminal_spawn', args: {} };
  rows[0]!.continuation = { hostConfirmationRequirement: Object.defineProperty({}, 'goalLaunch', { get: getter, enumerable: true }) };
  vi.spyOn(service, 'listPending').mockResolvedValue(rows);
  expect(await service.listPendingToolConfirmations('session')).toEqual([]);
  expect(getter).not.toHaveBeenCalled();
});
