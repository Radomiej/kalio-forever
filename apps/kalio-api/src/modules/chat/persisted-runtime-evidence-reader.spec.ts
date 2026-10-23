import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { PersistedRuntimeEvidenceReader } from './persisted-runtime-evidence-reader';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));
const tool = { messageId: 'result', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt', toolCallId: 'call', role: 'tool_result' as const };
const completed = { chatRunId: 'journal', sessionId: 'session', turnId: 'turn', revision: 3, promptMessageId: 'prompt', terminalMessageId: 'terminal' };
function fixture(content = 'abc') {
  const client = new Database(':memory:'); clients.push(client);
  client.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, turn_id TEXT, prompt_message_id TEXT, tool_call_id TEXT, created_at INTEGER NOT NULL)');
  client.exec('CREATE TABLE chat_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, outcome TEXT, completed_at INTEGER, updated_at INTEGER NOT NULL)');
  const insert = client.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run('result', 'session', 'tool_result', content, 'turn', 'prompt', 'call', 1234);
  insert.run('terminal', 'session', 'assistant', 'Finished', 'turn', 'prompt', null, 2345);
  client.prepare('INSERT INTO chat_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('journal', 'session', 'turn', 'completed', 'completed', 3, JSON.stringify({ messageId: 'terminal', finalText: 'Finished' }), 3456, 3456);
  return { client, reader: new PersistedRuntimeEvidenceReader({ db: drizzle(client, { schema }) } as unknown as DrizzleService) };
}
describe('PersistedRuntimeEvidenceReader real SQLite', () => {
  it('preserves Unicode/newlines/whitespace and hashes fresh DB content, not caller text', async () => {
    const content = '  Żółć\r\n😀  '; const { reader, client } = fixture(content);
    // Hand-derived UTF-8 bytes: spaces, Ż ó ł ć, CR LF, emoji, spaces.
    const bytes = Uint8Array.from([32, 32, 197, 187, 195, 179, 197, 130, 196, 135, 13, 10, 240, 159, 152, 128, 32, 32]);
    const result = await reader.readToolResultExact(tool);
    expect(result).toMatchObject({ content, contentUtf8Bytes: 18, contentSha256: createHash('sha256').update(bytes).digest('hex') });
    client.prepare("UPDATE messages SET content = ? WHERE id = 'result'").run('abc');
    const changed = await reader.readToolResultExact(tool);
    expect(changed?.contentSha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(changed?.contentSha256).not.toBe(result?.contentSha256);
  });
  it('accepts empty persisted content without fabricating or truncating bytes', async () => {
    expect(await fixture('').reader.readToolResultExact(tool)).toMatchObject({ content: '', contentUtf8Bytes: 0,
      contentSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
  });
  it('rejects undecodable stored UTF-8 instead of hashing replacement characters', async () => {
    const { reader, client } = fixture(); client.exec("UPDATE messages SET content = CAST(X'FF' AS TEXT) WHERE id = 'result'");
    await expect(reader.readToolResultExact(tool)).rejects.toThrow(/^DURABLE_EVIDENCE_CORRUPT$/);
  });
  it.each([1.5, -1, 8_640_000_000_000_001])('rejects raw timestamp %s without driver normalization', async createdAt => {
    const { reader, client } = fixture(); client.prepare("UPDATE messages SET created_at = ? WHERE id = 'result'").run(createdAt);
    await expect(reader.readToolResultExact(tool)).rejects.toThrow(/^DURABLE_EVIDENCE_CORRUPT$/);
  });
  it('returns exact DB bytes and independently known SHA-256 without dispatch trust claims', async () => {
    await expect(fixture().reader.readToolResultExact(tool)).resolves.toEqual({ ...tool, content: 'abc', contentUtf8Bytes: 3,
      contentSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', createdAt: 1234 });
  });
  it('reads only the exact completed journal and linked terminal assistant', async () => {
    await expect(fixture().reader.readCompletedRunExact(completed)).resolves.toEqual({ ...completed, phase: 'completed', status: 'completed', completedAt: 3456, updatedAt: 3456 });
  });
  it.each(['messageId', 'sessionId', 'turnId', 'promptMessageId', 'toolCallId'])('requires exact tool %s', async key => {
    await expect(fixture().reader.readToolResultExact({ ...tool, [key]: 'foreign' })).resolves.toBeNull();
  });
  it.each(['chatRunId', 'sessionId', 'turnId', 'promptMessageId', 'terminalMessageId', 'revision'])('requires exact journal %s', async key => {
    await expect(fixture().reader.readCompletedRunExact({ ...completed, [key]: key === 'revision' ? 4 : 'foreign' })).resolves.toBeNull();
  });
  it.each(['turn_id', 'prompt_message_id', 'tool_call_id'])('rejects legacy tool null %s', async column => {
    const { client, reader } = fixture(); client.exec(`UPDATE messages SET ${column} = NULL WHERE id = 'result'`);
    await expect(reader.readToolResultExact(tool)).resolves.toBeNull();
  });
  it.each(['session_id', 'turn_id', 'prompt_message_id', 'role'])('rejects foreign terminal %s', async column => {
    const { client, reader } = fixture(); client.exec(`UPDATE messages SET ${column} = 'foreign' WHERE id = 'terminal'`);
    await expect(reader.readCompletedRunExact(completed)).resolves.toBeNull();
  });
  it.each(['turn_id', 'prompt_message_id'])('rejects terminal legacy null %s', async column => {
    const { client, reader } = fixture(); client.exec(`UPDATE messages SET ${column} = NULL WHERE id = 'terminal'`);
    await expect(reader.readCompletedRunExact(completed)).resolves.toBeNull();
  });
  it.each(['phase', 'status'])('rejects incomplete journal %s', async column => {
    const { client, reader } = fixture(); client.exec(`UPDATE chat_runs SET ${column} = 'active'`);
    await expect(reader.readCompletedRunExact(completed)).resolves.toBeNull();
  });
  it.each(['assistant', 'system', 'user'])('never accepts %s as a tool result', async role => {
    const { reader, client } = fixture(); client.prepare("UPDATE messages SET role = ? WHERE id = 'result'").run(role);
    await expect(reader.readToolResultExact(tool)).resolves.toBeNull();
  });
  it('does not substitute a newer completed journal for an exact stale locator', async () => {
    const { reader, client } = fixture();
    client.exec("UPDATE chat_runs SET revision = 4; INSERT INTO chat_runs SELECT 'newer', session_id, turn_id, phase, status, 3, outcome, 9999, 9999 FROM chat_runs WHERE id = 'journal'");
    await expect(reader.readCompletedRunExact(completed)).resolves.toBeNull();
    await expect(reader.readCompletedRunExact({ ...completed, chatRunId: 'newer' })).resolves.toMatchObject({ chatRunId: 'newer', completedAt: 9999 });
  });
  it('does not substitute a different terminal message with matching turn linkage', async () => {
    const { reader, client } = fixture(); client.exec("DELETE FROM messages WHERE id = 'terminal'; INSERT INTO messages VALUES ('new-terminal', 'session', 'assistant', 'Finished', 'turn', 'prompt', NULL, 2345)");
    await expect(reader.readCompletedRunExact(completed)).resolves.toBeNull();
  });
  it.each(['completed_at', 'updated_at'])('rejects invalid persisted journal timestamp %s', async column => {
    const { reader, client } = fixture(); client.exec(`UPDATE chat_runs SET ${column} = -1`);
    await expect(reader.readCompletedRunExact(completed)).rejects.toThrow(/^DURABLE_EVIDENCE_CORRUPT$/);
  });
  it.each(['result', 'terminal'])('rejects invalid persisted message timestamp %s', async id => {
    const { reader, client } = fixture(); client.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run('not-a-date', id);
    await expect(id === 'result' ? reader.readToolResultExact(tool) : reader.readCompletedRunExact(completed)).rejects.toThrow(/^DURABLE_EVIDENCE_CORRUPT$/);
  });
  it('rejects null completed timestamp', async () => {
    const { reader, client } = fixture(); client.exec('UPDATE chat_runs SET completed_at = NULL');
    await expect(reader.readCompletedRunExact(completed)).rejects.toThrow(/^DURABLE_EVIDENCE_CORRUPT$/);
  });
  it.each(['{', '[]', '42', 'null'])('rejects corrupt outcome JSON %s with static errors', async content => {
    const { reader, client } = fixture(); client.prepare('UPDATE chat_runs SET outcome = ?').run(content);
    await expect(reader.readCompletedRunExact(completed)).rejects.toThrow(/^DURABLE_EVIDENCE_CORRUPT$/);
  });
  it.each(['messageId', 'sessionId', 'turnId', 'promptMessageId', 'toolCallId', 'role'])('requires valid nonempty tool locator %s', async field => {
    await expect(fixture().reader.readToolResultExact({ ...tool, [field]: '' })).rejects.toThrow(/^DURABLE_EVIDENCE_INVALID_INPUT$/);
  });
  it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid revision %s', async revision => {
    await expect(fixture().reader.readCompletedRunExact({ ...completed, revision })).rejects.toThrow(/^DURABLE_EVIDENCE_INVALID_INPUT$/);
  });
  it.each(['chatRunId', 'sessionId', 'turnId', 'promptMessageId', 'terminalMessageId'])('requires nonempty journal locator %s', async field => {
    await expect(fixture().reader.readCompletedRunExact({ ...completed, [field]: ' \n ' })).rejects.toThrow(/^DURABLE_EVIDENCE_INVALID_INPUT$/);
  });
  it.each(['symbol', 'hidden', 'extra', 'proxy'])('rejects locator %s without lossy normalization', async mode => {
    const { reader } = fixture(); const locator = { ...tool }; let traps = 0;
    if (mode === 'symbol') Reflect.set(locator, Symbol('secret'), 1);
    if (mode === 'hidden') Object.defineProperty(locator, 'secret', { value: 1 });
    if (mode === 'extra') Reflect.set(locator, 'content', 'forged');
    const supplied = mode === 'proxy' ? new Proxy(locator, { ownKeys(target) { traps++; return Reflect.ownKeys(target); } }) : locator;
    await expect(reader.readToolResultExact(supplied)).rejects.toThrow(/^DURABLE_EVIDENCE_INVALID_INPUT$/); expect(traps).toBe(0);
  });
  it.each(['NULL', "'{}'", "'{\"messageId\":\"foreign\"}'"])('rejects absent/mismatched outcome linkage %s', async expression => {
    const { client, reader } = fixture(); client.exec(`UPDATE chat_runs SET outcome = ${expression}`);
    await expect(reader.readCompletedRunExact(completed)).resolves.toBeNull();
  });
  it.each(['tool', 'journal'])('rejects locator accessors before execution: %s', async kind => {
    const { reader } = fixture(); let reads = 0; const locator = kind === 'tool' ? { ...tool } : { ...completed };
    Object.defineProperty(locator, 'sessionId', { enumerable: true, get() { reads++; return 'session'; } });
    await expect(kind === 'tool' ? reader.readToolResultExact(locator as typeof tool) : reader.readCompletedRunExact(locator as typeof completed)).rejects.toThrow(/^DURABLE_EVIDENCE_INVALID_INPUT$/);
    expect(reads).toBe(0);
  });
  it.each(['tool', 'journal'])('sanitizes storage errors: %s', async kind => {
    const { client, reader } = fixture(); client.exec(`DROP TABLE ${kind === 'tool' ? 'messages' : 'chat_runs'}`);
    await expect(kind === 'tool' ? reader.readToolResultExact(tool) : reader.readCompletedRunExact(completed)).rejects.toThrow(/^DURABLE_EVIDENCE_STORAGE_ERROR$/);
  });
});

const terminal = { chatRunId: 'journal', sessionId: 'session', turnId: 'turn', revision: 3,
  promptMessageId: 'prompt', status: 'failed' as const, phase: 'failed' as const, outcomeMessageId: null };
function terminalFixture() {
  const result = fixture();
  result.client.exec("INSERT INTO messages VALUES ('prompt', 'session', 'user', 'secret prompt', 'turn', 'prompt', NULL, 1000); UPDATE chat_runs SET phase = 'failed', status = 'failed', outcome = NULL");
  return result;
}
describe('exact non-completed terminal journal real SQLite', () => {
  it.each(['failed', 'cancelled', 'interrupted'] as const)('preserves actual %s status and phase without completion relabel', async status => {
    const { reader, client } = terminalFixture();
    const phase: 'queued' | 'failed' | 'interrupted' = status === 'cancelled' ? 'queued' : status;
    client.prepare('UPDATE chat_runs SET status = ?, phase = ?, completed_at = NULL').run(status, phase);
    const locator = { ...terminal, status, phase };
    await expect(reader.readTerminalRunExact(locator)).resolves.toEqual({ ...locator, updatedAt: 3456, completedAt: null, outcome: null });
    await expect(reader.readCompletedRunExact(completed)).resolves.toBeNull();
  });
  it('hashes exact stored outcome bytes and requires its exact assistant linkage', async () => {
    const { reader, client } = terminalFixture(); const raw = ' { "messageId": "terminal", "finalText": "Żółć 😀" }\n';
    client.prepare('UPDATE chat_runs SET outcome = ?').run(raw);
    const locator = { ...terminal, outcomeMessageId: 'terminal' };
    await expect(reader.readTerminalRunExact(locator)).resolves.toEqual({ ...locator, updatedAt: 3456, completedAt: 3456,
      outcome: { messageId: 'terminal', outcomeUtf8Bytes: Buffer.byteLength(raw), outcomeSha256: createHash('sha256').update(raw).digest('hex') } });
    await expect(reader.readTerminalRunExact(terminal)).resolves.toBeNull();
  });
  it('distinguishes absent outcome from an outcome without message linkage', async () => {
    const { reader, client } = terminalFixture(); client.exec("UPDATE chat_runs SET outcome = '{}' ");
    await expect(reader.readTerminalRunExact(terminal)).resolves.toMatchObject({ outcome: { messageId: null, outcomeUtf8Bytes: 2 } });
    await expect(reader.readTerminalRunExact({ ...terminal, outcomeMessageId: 'terminal' })).resolves.toBeNull();
  });
  it.each(['chatRunId', 'sessionId', 'turnId', 'revision', 'promptMessageId', 'status', 'phase', 'outcomeMessageId'])('requires exact %s', async field => {
    const wrong = field === 'revision' ? 4 : field === 'status' ? 'interrupted' : field === 'phase' ? 'interrupted' : 'foreign';
    await expect(terminalFixture().reader.readTerminalRunExact({ ...terminal, [field]: wrong })).resolves.toBeNull();
  });
  it.each(['session_id', 'turn_id', 'prompt_message_id', 'role'])('requires exact local prompt %s', async column => {
    const { reader, client } = terminalFixture(); client.exec(`UPDATE messages SET ${column} = 'foreign' WHERE id = 'prompt'`);
    await expect(reader.readTerminalRunExact(terminal)).resolves.toBeNull();
  });
  it.each(['session_id', 'turn_id', 'prompt_message_id', 'role'])('requires exact outcome assistant %s', async column => {
    const { reader, client } = terminalFixture(); client.exec(`UPDATE chat_runs SET outcome = '{"messageId":"terminal"}'; UPDATE messages SET ${column} = 'foreign' WHERE id = 'terminal'`);
    await expect(reader.readTerminalRunExact({ ...terminal, outcomeMessageId: 'terminal' })).resolves.toBeNull();
  });
  it('never substitutes latest, chronological prompts or another terminal message', async () => {
    const { reader, client } = terminalFixture();
    client.exec("UPDATE chat_runs SET revision = 4; INSERT INTO chat_runs SELECT 'newer', session_id, turn_id, phase, status, 3, outcome, completed_at, 9999 FROM chat_runs; DELETE FROM messages WHERE id = 'prompt'");
    await expect(reader.readTerminalRunExact(terminal)).resolves.toBeNull();
    await expect(reader.readTerminalRunExact({ ...terminal, chatRunId: 'newer' })).resolves.toBeNull();
  });
  it.each(['completed', 'active', 'queued', 'waiting_for_human', 'interrupted_needs_retry'])('rejects noneligible locator status %s', async status => {
    await expect(terminalFixture().reader.readTerminalRunExact({ ...terminal, status } as unknown as typeof terminal)).rejects.toThrow(/^DURABLE_EVIDENCE_INVALID_INPUT$/);
  });
  it.each(['{', 'null', '[]', '42', '{"messageId":42}', '{"messageId":null}'])('rejects corrupt outcome %s', async raw => {
    const { reader, client } = terminalFixture(); client.prepare('UPDATE chat_runs SET outcome = ?').run(raw);
    await expect(reader.readTerminalRunExact(terminal)).rejects.toThrow(/^DURABLE_EVIDENCE_CORRUPT$/);
  });
  it('rejects invalid UTF-8 outcome bytes', async () => {
    const { reader, client } = terminalFixture(); client.exec("UPDATE chat_runs SET outcome = CAST(X'FF' AS TEXT)");
    await expect(reader.readTerminalRunExact(terminal)).rejects.toThrow(/^DURABLE_EVIDENCE_CORRUPT$/);
  });
  it.each(['completed_at', 'updated_at'])('rejects corrupt timestamp %s', async column => {
    const { reader, client } = terminalFixture(); client.exec(`UPDATE chat_runs SET ${column} = -1`);
    await expect(reader.readTerminalRunExact(terminal)).rejects.toThrow(/^DURABLE_EVIDENCE_CORRUPT$/);
  });
  it.each(['getter', 'proxy', 'symbol', 'hidden', 'extra', 'prototype', 'missing'])('rejects descriptor-unsafe %s without invoking code', async mode => {
    const { reader } = terminalFixture(); const locator = { ...terminal }; let reads = 0;
    if (mode === 'getter') Object.defineProperty(locator, 'sessionId', { enumerable: true, get() { reads++; return 'session'; } });
    if (mode === 'symbol') Reflect.set(locator, Symbol('extra'), 1);
    if (mode === 'hidden') Object.defineProperty(locator, 'extra', { value: 1 });
    if (mode === 'extra') Reflect.set(locator, 'extra', 1);
    if (mode === 'prototype') Object.setPrototypeOf(locator, { inherited: 1 });
    if (mode === 'missing') Reflect.deleteProperty(locator, 'outcomeMessageId');
    const supplied = mode === 'proxy' ? new Proxy(locator, { ownKeys(target) { reads++; return Reflect.ownKeys(target); } }) : locator;
    await expect(reader.readTerminalRunExact(supplied)).rejects.toThrow(/^DURABLE_EVIDENCE_INVALID_INPUT$/); expect(reads).toBe(0);
  });
  it('sanitizes storage failures', async () => {
    const { reader, client } = terminalFixture(); client.exec('DROP TABLE chat_runs');
    await expect(reader.readTerminalRunExact(terminal)).rejects.toThrow(/^DURABLE_EVIDENCE_STORAGE_ERROR$/);
  });
  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid terminal revision %s', async revision => {
    await expect(terminalFixture().reader.readTerminalRunExact({ ...terminal, revision })).rejects.toThrow(/^DURABLE_EVIDENCE_INVALID_INPUT$/);
  });
  it('rejects unknown phase and malformed optional outcome identity', async () => {
    const { reader } = terminalFixture();
    await expect(reader.readTerminalRunExact({ ...terminal, phase: 'cancelled' } as unknown as typeof terminal)).rejects.toThrow(/^DURABLE_EVIDENCE_INVALID_INPUT$/);
    await expect(reader.readTerminalRunExact({ ...terminal, outcomeMessageId: '' })).rejects.toThrow(/^DURABLE_EVIDENCE_INVALID_INPUT$/);
  });
  it.each(['prompt', 'terminal'])('rejects corrupt linked %s timestamp', async id => {
    const { reader, client } = terminalFixture(); client.exec('UPDATE chat_runs SET outcome = \'{"messageId":"terminal"}\'');
    client.prepare('UPDATE messages SET created_at = -1 WHERE id = ?').run(id);
    await expect(reader.readTerminalRunExact({ ...terminal, outcomeMessageId: 'terminal' })).rejects.toThrow(/^DURABLE_EVIDENCE_CORRUPT$/);
  });
  it('rejects missing outcome assistant rather than substituting a same-turn assistant', async () => {
    const { reader, client } = terminalFixture();
    client.exec('UPDATE chat_runs SET outcome = \'{"messageId":"terminal"}\'; UPDATE messages SET id = \'other-assistant\' WHERE id = \'terminal\'');
    await expect(reader.readTerminalRunExact({ ...terminal, outcomeMessageId: 'terminal' })).resolves.toBeNull();
  });
  it('accepts descriptor-safe null-prototype locators without normalizing opaque IDs', async () => {
    const { reader } = terminalFixture();
    await expect(reader.readTerminalRunExact(Object.assign(Object.create(null) as typeof terminal, terminal))).resolves.toMatchObject(terminal);
    await expect(reader.readTerminalRunExact({ ...terminal, sessionId: ' session ' })).resolves.toBeNull();
  });
});
