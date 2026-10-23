import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema';
import type { DrizzleService } from '../../database/drizzle.service';
import type { MCPService } from '../mcp/mcp.service';
import { HostDispatchReceiptService } from './host-dispatch-receipt.service';
import { PersistedRuntimeEvidenceReader } from './persisted-runtime-evidence-reader';
import { ToolDispatchService } from './tool-dispatch.service';
import { TurnState } from './turn-state';
import { serializeToolResultContent } from './llm-turn-tool-execution';
import type { HostResolvedToolDispatch } from '@kalio/types';

describe('concrete dispatcher receipt composition', () => {
  it.each([false, true])('binds actual entry, not pre-entry Stop, across service recreation (stop=%s)', async stop => {
    const client = new Database(':memory:');
    try {
      client.exec(readFileSync(join(__dirname, '../../database/migrations/0037_host_dispatch_receipts.sql'), 'utf8'));
      client.exec('CREATE TABLE messages (id TEXT PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,turn_id TEXT,prompt_message_id TEXT,tool_call_id TEXT,created_at INTEGER)');
      client.exec('CREATE TABLE chat_runs (id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,revision INTEGER)');
      client.exec("INSERT INTO chat_runs VALUES ('r','s','t',1); INSERT INTO messages VALUES ('p','s','user','test','t','p',NULL,1)");
      const db = drizzle(client, { schema });
      const provider = { db } as unknown as DrizzleService;
      const entry = { meta: { name: 'fs_read', description: '', parameters: {}, requiresConfirmation: false },
        catalogEntryId: 'catalog.read', executorImplementationId: 'executor.read', executorImplementationVersion: 1,
        execute: vi.fn(async () => ({ text: 'Zażółć 🧪' })) };
      const mcp = { getAllTools: () => [], resolveToolName: () => null } as unknown as MCPService;
      const create = () => new HostDispatchReceiptService(provider, [entry], new PersistedRuntimeEvidenceReader(provider), mcp);
      const service = create(); const identity = { runId: 'r', sessionId: 's', turnId: 't', promptMessageId: 'p' };
      const args = { z: 1, a: { z: 2, a: 3 }, list: [{ z: 4, a: 5 }] };
      const call = service.recorder.createCallRecorder({ identity, callId: 'c', toolName: 'fs_read', args });
      let resolved: HostResolvedToolDispatch | null = null;
      let entered = false;
      const controller = new AbortController();
      const dispatcher = new ToolDispatchService([entry], null, null, null);
      const result = await dispatcher.dispatch('c', 'fs_read', args, { ...identity, messageId: 'assistant',
        abortSignal: controller.signal, state: new TurnState(), emit: vi.fn(),
        onResolvedToolDispatch: async receipt => { await call.resolved(receipt); resolved = receipt; if (stop) controller.abort(); },
        onToolExecutorEntered: () => { if (!resolved) throw new Error('missing'); call.entered(resolved); entered = true; },
      });
      const content = serializeToolResultContent('fs_read', result);
      client.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('result', 's', 'tool_result', content, 't', 'p', 'c', 2);
      await call.commit({ identity, callId: 'c', toolName: 'fs_read', persistedMessageId: 'result',
        contentSha256: createHash('sha256').update(content).digest('hex'), status: result.status,
        registeredCommitAck: 'not_registered', resolvedDispatch: entered ? resolved : null, hitlCommit: null });
      const receipt = await create().recorder.readExact({ ...identity, callId: 'c' });
      if (stop) expect(receipt?.payload.enteredTarget).toBeNull();
      else expect(receipt?.payload.enteredTarget).toMatchObject({ catalogEntryId: 'catalog.read', executorImplementationVersion: 1 });
      expect(receipt?.payload.result.contentUtf8Bytes).toBe(Buffer.byteLength(content));
      expect(receipt?.payload.argsSha256).toBe(createHash('sha256').update(JSON.stringify({
        a: { a: 3, z: 2 }, list: [{ a: 5, z: 4 }], z: 1,
      })).digest('hex'));
      const facts = await create().readDispatchFactsExact(identity, 'c');
      expect(facts).toMatchObject({ identity, callId: 'c', canonicalName: stop ? null : 'fs_read', target: stop ? null : 'kalio_registry',
        approval: stop ? null : { kind: 'non_durable', reason: 'not_required' },
        resultMessageId: 'result', resultStatus: stop ? 'cancelled' : 'success', contentSha256: receipt?.payload.result.contentSha256 });
      expect(facts).not.toHaveProperty('evidence');
      expect(facts).not.toHaveProperty('build');
      expect(await create().readDispatchFactsExact(identity, 'absent')).toBeNull();
      expect(entry.execute).toHaveBeenCalledTimes(stop ? 0 : 1);
      client.prepare("UPDATE messages SET role='assistant' WHERE id='p'").run();
      await expect(create().recorder.readExact({ ...identity, callId: 'c' })).rejects.toThrow('HOST_DISPATCH_RECEIPT_AUTHORITY');
      await expect(create().readDispatchFactsExact(identity, 'c')).rejects.toThrow('HOST_DISPATCH_RECEIPT_AUTHORITY');
    } finally { client.close(); }
  });
});
