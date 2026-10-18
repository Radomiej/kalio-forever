import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { ExecutionProfileService } from '../agent-runtime/execution-profile.service';
import { ActiveSessionRegistry } from './active-session-registry.service';
import { ChatService } from './chat.service';
import { DrizzleMessageRepository } from './drizzle-message.repository';
import type { LLMTurnRuntimeService } from './llm-turn-runtime.service';
import { SessionEventsService } from './session-events.service';
import { SessionManagerService } from './session-manager.service';
import { SessionPipelineService } from './session-pipeline.service';
import { SessionsService } from './sessions.service';
import { SessionProfileAdmissionService } from './session-profile-admission.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('session profile update versus turn admission (SQLite integration)', () => {
  it('never executes a profile different from the durable binding after an overlapping update', async () => {
    const client = new Database(':memory:');
    const historyRead = deferred();
    const releaseHistory = deferred();
    const releaseLoop = deferred();
    let update: Promise<{ error?: unknown }> | undefined;
    let submitted: Promise<void> | undefined;
    try {
      client.pragma('foreign_keys = ON');
      const db = drizzle(client, { schema });
      migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
      const now = new Date();
      db.insert(schema.executionProfiles).values(['old-profile', 'new-profile'].map(id => ({
        id, name: id, kind: 'direct-llm' as const, provider: 'openai' as const,
        model: id, enabled: true, createdAt: now, updatedAt: now,
      }))).run();
      db.insert(schema.personas).values({
        id: 'persona', name: 'Test', model: 'old-profile', executionProfileId: 'old-profile',
        createdAt: now, updatedAt: now,
      }).run();
      db.insert(schema.sessions).values({
        id: 'session', personaId: 'persona', executionProfileId: 'old-profile',
        createdAt: now, updatedAt: now,
      }).run();
      const database = Object.create(DrizzleService.prototype) as DrizzleService;
      Object.assign(database, { db });
      const events = new SessionEventsService();
      const repository = new DrizzleMessageRepository(database, events);
      const profiles = new ExecutionProfileService(database);
      const registry = new ActiveSessionRegistry();
      const profileAdmission = new SessionProfileAdmissionService();
      const manager = Object.create(SessionManagerService.prototype) as SessionManagerService;
      Object.assign(manager, {
        repo: repository,
      });
      const sessions = Object.create(SessionsService.prototype) as SessionsService;
      Object.assign(sessions, {
        drizzle: database, repo: repository, sessionEvents: events,
        activeSessionRegistry: registry, executionProfiles: profiles, profileAdmission,
      });
      // Pause only the first real SELECT result, not persistence or admission.
      const loadHistory = repository.loadHistory.bind(repository);
      vi.spyOn(repository, 'loadHistory').mockImplementationOnce(async id => {
        const snapshot = await loadHistory(id);
        historyRead.resolve();
        await releaseHistory.promise;
        return snapshot;
      });
      const executedProfiles: (string | undefined)[] = [];
      const runAgentLoop: LLMTurnRuntimeService['runAgentLoop'] = async request => {
        executedProfiles.push(request.executionProfile?.id);
        await releaseLoop.promise;
        return {
          lastMessageId: 'response', finalText: 'Test response', iterationCount: 1,
          finalLimit: 1, exhausted: false, aborted: false,
          emptyNoToolRetriesExhausted: false, maxIterationsReached: false,
        };
      };
      // The provider loop is the external boundary: no live LLM/CLI is invoked.
      const chat = new ChatService(
        manager,
        { getMaxToolAttempts: async () => 1 } as ConstructorParameters<typeof ChatService>[1],
        { log: async () => undefined } as unknown as ConstructorParameters<typeof ChatService>[2],
        { runAgentLoop } as LLMTurnRuntimeService,
        {} as ConstructorParameters<typeof ChatService>[4],
        sessions,
        undefined,
        { assembleForSessionRuntime: async () => ({
          effectiveSystemPrompt: 'Test', toolMetas: [], model: 'old-profile',
        }) } as unknown as ConstructorParameters<typeof ChatService>[7],
        undefined, undefined, undefined, profiles,
      );
      const pipeline = new SessionPipelineService(chat, undefined, registry, profileAdmission);
      const errors: unknown[] = [];
      update = sessions.updateWithOptions('session', { executionProfileId: 'new-profile' })
        .then(() => ({}), (error: unknown) => ({ error }));
      await historyRead.promise;
      submitted = pipeline.submit({ sessionId: 'session', personaId: 'persona', content: 'Hello' },
        (event, data) => { if (event === 'chat:error') errors.push(data); });
      // Yield one event-loop boundary so admission can progress. No timed sleep;
      // a future shared barrier may instead keep this submit waiting for update.
      await setImmediate();
      releaseHistory.resolve();
      const result = await update;
      releaseLoop.resolve();
      await submitted;
      const durable = await sessions.get('session');
      expect(errors).toEqual([]);
      expect(await loadHistory('session')).toHaveLength(1);
      expect(pipeline.getSessionStatus('session').active).toBe(false);
      expect(registry.isActive('session')).toBe(false);
      if (result.error !== undefined) {
        expect(result.error).toBeInstanceOf(ConflictException);
        expect(durable.executionProfileId).toBe('old-profile');
        expect(executedProfiles).toEqual(['old-profile']);
      } else {
        expect(durable.executionProfileId).toBe('new-profile');
        expect(executedProfiles).toEqual(['new-profile']);
      }
    } finally {
      releaseHistory.resolve();
      releaseLoop.resolve();
      await Promise.allSettled([update, submitted]);
      vi.restoreAllMocks();
      client.close();
    }
  });
});
