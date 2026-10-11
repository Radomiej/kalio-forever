import { describe, expect, it } from 'vitest';
import type { ArchitectureRun, ArchitectureSchema, ChatMessage } from '@kalio/types';
import type { SessionsService } from '../chat/sessions.service';
import type { SessionManagerService } from '../chat/session-manager.service';
import { ArchitectureRuntimeChatProjectionService } from './architecture-runtime-chat-projection.service';

const schema: ArchitectureSchema = {
  id: 'schema', name: 'Council', description: '', version: '1', roleSlots: [], nodes: [], edges: [],
  routerPolicy: { mode: 'rank_then_merge', mustAddressCriticFindings: false, canReturnNeedsMoreResearch: false },
  contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
  memoryPolicy: { persistFinalArtifact: false, persistRouterDecision: false }, outputArtifactSchema: 'Artifact',
};
const run: ArchitectureRun = {
  id: 'run', schemaId: 'schema', rootSessionId: 'root', prompt: 'Delegated task',
  executionMode: 'subagent_execution', status: 'completed', createdAt: 1, updatedAt: 2,
  context: { parentSessionId: 'parent', parentTurnId: 'source-turn', promptMessageId: 'source-user' },
};
const source: ChatMessage = {
  id: 'source-user', sessionId: 'parent', role: 'user', content: 'Original human goal',
  turnId: 'source-turn', promptMessageId: 'source-user', createdAt: 1,
};

function fixture(fallback: boolean) {
  const rows = new Map<string, ChatMessage>([[source.id, { ...source }]]);
  const sessions = { getMessages: async (id: string) => {
    if (fallback && id === 'parent') throw new Error('Parent unavailable');
    return [...rows.values()].filter(message => message.sessionId === id);
  } };
  const manager = { persistMessage: async (message: ChatMessage) => {
    if (rows.has(message.id)) throw new Error(`Global message PK collision: ${message.id}`);
    rows.set(message.id, message);
  } };
  const service = new ArchitectureRuntimeChatProjectionService(
    sessions as unknown as SessionsService, manager as unknown as SessionManagerService,
  );
  return { service, rows };
}

describe('ArchitectureRuntimeChatProjectionService source linkage', () => {
  for (const fallback of [false, true]) {
    it(`preserves source message and durable linkage with root fallback=${fallback}`, async () => {
      const { service, rows } = fixture(fallback);
      const events = [{ id: 'final', runId: 'run', sequence: 1, type: 'final_artifact' as const,
        nodeId: 'final', message: 'Result', createdAt: 2 }];
      await service.persistParent(schema, run, events);
      await service.persistParent(schema, run, events);
      expect(rows.get('source-user')).toEqual(source);
      const target = fallback ? 'root' : 'parent';
      const projected = [...rows.values()].filter(message => message.id !== 'source-user');
      expect(projected.filter(message => message.role === 'user')).toHaveLength(fallback ? 1 : 0);
      expect(projected.every(message => message.sessionId === target)).toBe(true);
      expect(projected.every(message => message.promptMessageId === 'source-user')).toBe(true);
      expect(projected.every(message => message.turnId === (fallback ? 'architecture-turn-run' : 'source-turn'))).toBe(true);
      expect(rows.get('architecture:run:text:final')?.content).toContain('Result');
      if (fallback) expect(rows.get('architecture:run:user')?.content).toBe('Delegated task');
    });
  }
});
