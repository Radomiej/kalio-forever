import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { VectorStoreService } from './vector-store.service';

describe('VectorStoreService schema migration', () => {
  it('does not hide unexpected embedding_model migration failures', () => {
    const originalExec = Database.prototype.exec;
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
      execSpy.mockRestore();
    }
  });
});
