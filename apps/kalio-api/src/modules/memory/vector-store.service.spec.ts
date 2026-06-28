import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { VectorStoreService } from './vector-store.service';

describe('VectorStoreService schema migration', () => {
  it('skips embedding_model ALTER when the column already exists', () => {
    const originalExec = Database.prototype.exec;
    const execSpy = vi.spyOn(Database.prototype, 'exec').mockImplementation(function execWithFailure(
      this: Database.Database,
      source: string,
    ) {
      if (source.includes('ALTER TABLE memories ADD COLUMN embedding_model')) {
        throw new Error('ALTER should not run for a fresh schema');
      }
      return originalExec.call(this, source);
    });

    try {
      expect(() => new VectorStoreService(':memory:', 384)).not.toThrow();
    } finally {
      execSpy.mockRestore();
    }
  });

  it('does not hide unexpected embedding_model ALTER failures for legacy schemas', () => {
    const originalPrepare = Database.prototype.prepare;
    const originalExec = Database.prototype.exec;
    const prepareSpy = vi.spyOn(Database.prototype, 'prepare').mockImplementation(function prepareLegacySchema(
      this: Database.Database,
      source: string,
    ) {
      if (source === 'PRAGMA table_info(memories)') {
        return { all: () => [{ name: 'id' }, { name: 'content' }] } as ReturnType<Database.Database['prepare']>;
      }
      return originalPrepare.call(this, source);
    });
    const execSpy = vi.spyOn(Database.prototype, 'exec').mockImplementation(function execWithFailure(
      this: Database.Database,
      source: string,
    ) {
      if (source.includes('ALTER TABLE memories ADD COLUMN embedding_model')) {
        throw new Error('disk is locked');
      }
      return originalExec.call(this, source);
    });

    try {
      expect(() => new VectorStoreService(':memory:', 384)).toThrow('disk is locked');
    } finally {
      prepareSpy.mockRestore();
      execSpy.mockRestore();
    }
  });
});
