import { describe, expect, it, vi } from 'vitest';
import type { ChatSession, ExecutionProfile, Project } from '@kalio/types';
import { createGoalReceiptScopeReader } from './architecture-goal-receipt-scope';

function fixture() {
  const key = { rootSessionId: 'root', branchSessionId: 'branch', projectId: 'project', executionProfileId: 'devin' };
  const root = { id: 'root', projectId: 'project', executionProfileId: 'devin',
    runtimeContext: { architectureContext: { executionCwd: 'E:/home' } } } as ChatSession;
  const branch = { id: 'branch', kind: 'subagent', parentSessionId: 'root', projectId: 'project', executionProfileId: 'devin',
    runtimeContext: { architectureContext: { projectPath: 'E:/home', executionCwd: 'E:/home' } } } as ChatSession;
  const ports = {
    sessions: { get: vi.fn(async (id: string) => id === 'root' ? root : branch) },
    projects: { assertAssignable: vi.fn(async () => ({ id: 'project', kind: 'workspace', path: 'E:/home' }) as Project) },
    profiles: { assertEnabled: vi.fn(async () => ({ id: 'devin' }) as ExecutionProfile) },
    vfs: { assertProjectExecutionCwd: vi.fn(() => ({ projectRoot: 'E:/home', cwd: 'E:/home' })) },
  };
  return { key, root, branch, ports, reader: createGoalReceiptScopeReader(ports) };
}

describe('registered goal receipt scope', () => {
  it('returns persisted internal-root linkage and VFS canonical scope', async () => {
    const f = fixture();
    await expect(f.reader.readRegisteredScope(f.key)).resolves.toEqual({ ...f.key,
      parentSessionId: 'root', canonicalProjectRoot: 'E:/home', canonicalCwd: 'E:/home' });
    expect(f.ports.profiles.assertEnabled).toHaveBeenCalledWith('devin');
  });
  it.each(['parentSessionId', 'projectId', 'executionProfileId'] as const)('rejects mismatched child %s', async field => {
    const f = fixture(); f.branch[field] = 'foreign';
    await expect(f.reader.readRegisteredScope(f.key)).rejects.toThrow('GOAL_RECEIPT_SCOPE_INVALID');
  });
  it('rejects linkage changed while profile resolution awaits', async () => {
    const f = fixture();
    f.ports.profiles.assertEnabled.mockImplementation(async () => {
      f.branch.parentSessionId = 'foreign'; return { id: 'devin' } as ExecutionProfile;
    });
    await expect(f.reader.readRegisteredScope(f.key)).rejects.toThrow('GOAL_RECEIPT_SCOPE_INVALID');
  });
  it('rejects changed canonical scope on final read', async () => {
    const f = fixture();
    f.ports.vfs.assertProjectExecutionCwd.mockReturnValueOnce({ projectRoot: 'E:/home', cwd: 'E:/home' })
      .mockReturnValue({ projectRoot: 'E:/foreign', cwd: 'E:/foreign' });
    await expect(f.reader.readRegisteredScope(f.key)).rejects.toThrow('GOAL_RECEIPT_SCOPE_INVALID');
  });
  it.each(['missing', 'foreign'])('rejects %s persisted branch scope', async kind => {
    const f = fixture();
    f.branch.runtimeContext = kind === 'missing' ? undefined : {
      runtimeKind: 'chat', architectureContext: { projectPath: 'E:/foreign', executionCwd: 'E:/foreign' },
    };
    await expect(f.reader.readRegisteredScope(f.key)).rejects.toThrow('GOAL_RECEIPT_SCOPE_INVALID');
  });
  it('rejects child drift during the final profile await', async () => {
    const f = fixture(); let calls = 0;
    f.ports.profiles.assertEnabled.mockImplementation(async () => {
      if (++calls === 2) f.branch.parentSessionId = 'foreign';
      return { id: 'devin' } as ExecutionProfile;
    });
    await expect(f.reader.readRegisteredScope(f.key)).rejects.toThrow('GOAL_RECEIPT_SCOPE_INVALID');
  });
});
