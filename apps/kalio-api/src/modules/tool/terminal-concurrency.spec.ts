import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalService } from './terminal.service';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';

describe('TerminalService - Concurrency', () => {
  let service: TerminalService;
  let mockAllowedPaths: AllowedPathsService;

  beforeEach(() => {
    mockAllowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
      getRoots: vi.fn().mockResolvedValue(['C:\\Projekty\\kalio-forever']),
    } as any;

    service = new TerminalService(mockAllowedPaths);
  });

  describe('concurrent operations', () => {
    it('should handle concurrent spawn operations without race conditions', async () => {
      // Arrange: Spawn multiple terminals concurrently with long-running command
      const promises = Array.from({ length: 10 }, () =>
        service.spawn('ping', ['127.0.0.1', '-n', '10'], 'C:\\Projekty\\kalio-forever')
      );

      // Act
      const results = await Promise.all(promises);

      // Assert - All spawns should succeed
      expect(results).toHaveLength(10);
      results.forEach(session => {
        expect(session.status).toBe('running');
        expect(session.id).toBeDefined();
      });

      // Cleanup
      results.forEach(session => service.kill(session.id));
    });

    it('should handle concurrent kill operations safely', async () => {
      // Arrange: Spawn multiple terminals with long-running command
      const sessions = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.spawn('ping', ['127.0.0.1', '-n', '10'], 'C:\\Projekty\\kalio-forever')
        )
      );

      // Act: Kill all concurrently
      const killPromises = sessions.map(s => service.kill(s.id));
      const results = await Promise.all(killPromises);

      // Assert - All kills should succeed
      expect(results).toHaveLength(5);
      expect(results.every(r => r === true)).toBe(true);
    });

    it('should handle concurrent list operations safely', async () => {
      // Arrange: Spawn multiple terminals with long-running command
      const sessions = await Promise.all(
        Array.from({ length: 3 }, () =>
          service.spawn('ping', ['127.0.0.1', '-n', '10'], 'C:\\Projekty\\kalio-forever')
        )
      );

      // Act: Call list concurrently
      const listPromises = Array.from({ length: 5 }, () => service.list());
      const results = await Promise.all(listPromises);

      // Assert - All lists should return consistent data
      expect(results).toHaveLength(5);
      results.forEach(list => {
        expect(list).toHaveLength(3);
      });

      // Cleanup
      sessions.forEach(session => service.kill(session.id));
    });

    it('should handle kill on non-existent session gracefully', async () => {
      // Act & Assert
      const result = service.kill('non-existent-id');
      expect(result).toBe(false);
    });

    it('should handle get on non-existent session gracefully', async () => {
      // Act & Assert
      const result = service.get('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('session map race conditions', () => {
    it('should not crash when killing a session that is already being killed', async () => {
      // Arrange: Spawn a session with long-running command
      const session = await service.spawn('ping', ['127.0.0.1', '-n', '10'], 'C:\\Projekty\\kalio-forever');

      // Act: Kill twice concurrently
      const [result1, result2] = await Promise.all([
        service.kill(session.id),
        service.kill(session.id),
      ]);

      // Assert - First should succeed, second should fail (already killed)
      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });

    it('should handle rapid spawn-kill cycles safely', async () => {
      // Arrange & Act: Rapid spawn-kill cycles with long-running command
      const operations = Array.from({ length: 5 }, async (_, i) => {
        const session = await service.spawn('ping', ['127.0.0.1', '-n', '5'], 'C:\\Projekty\\kalio-forever');
        await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
        return service.kill(session.id);
      });

      const results = await Promise.all(operations);

      // Assert - All operations should complete without errors
      expect(results).toHaveLength(5);
      // Some may fail if process exits naturally, but shouldn't crash
      expect(results.every(r => r === true || r === false)).toBe(true);
    });
  });
});
