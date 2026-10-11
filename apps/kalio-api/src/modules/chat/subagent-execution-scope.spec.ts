import { describe, expect, it, vi } from 'vitest';
import { prepareSubagentExecution, resolveObservedSubagentScope } from './subagent-execution-scope';

function fixture() {
  const parent = { id: 'parent', projectId: 'project', executionProfileId: 'saved-profile', runtimeContext: { runtimeKind: 'chat', architectureContext: { executionCwd: '/root/src' } } };
  let child = { id: 'child', kind: 'subagent', parentSessionId: 'parent', projectId: 'project', executionProfileId: 'saved-profile', runtimeContext: { runtimeKind: 'subagent', architectureContext: { executionCwd: '/stale' } } };
  const sessions = {
    get: vi.fn(async (id: string) => id === 'parent' ? parent : child),
    createWithId: vi.fn(async () => child),
    updateRuntimeContext: vi.fn(async (_id: string, runtimeContext: typeof child.runtimeContext) => { child = { ...child, runtimeContext }; }),
  };
  const project = { id: 'project', kind: 'workspace', path: '/root' };
  const projects = { assertAssignable: vi.fn(async () => project) };
  const vfs = { assertProjectExecutionCwd: vi.fn((root: string, cwd: string) => ({ projectRoot: root, cwd })) };
  const executionProfiles = { assertEnabled: vi.fn(async () => ({ id: 'saved-profile', model: 'swe-2' })) };
  const resolve = () => resolveObservedSubagentScope({ sessions: sessions as never, projects: projects as never, vfs: vfs as never, parentSessionId: 'parent', childSessionId: 'child' });
  const prepare = async (newChild = false) => prepareSubagentExecution({ sessions: sessions as never,
    childSessionId: 'child', requestedChildSessionId: newChild ? undefined : 'child', parentSessionId: 'parent', personaId: 'worker', objective: 'task',
    runtimeContext: { runtimeKind: 'subagent', architectureContext: { projectPath: '/root', executionCwd: '/root/src' } },
    observedScope: await resolve(), executionProfiles: executionProfiles as never });
  return { parent, project, get child() { return child; }, sessions, projects, vfs, executionProfiles, resolve, prepare };
}

describe('observed persisted subagent execution scope', () => {
  it.each(['bootstrap', 'profile'] as const)('rejects changed persisted cwd during awaited %s despite unchanged linkage', async stage => {
    const f = fixture();
    if (stage === 'bootstrap') {
      const update = f.sessions.updateRuntimeContext.getMockImplementation()!;
      f.sessions.updateRuntimeContext.mockImplementationOnce(async (...args) => {
        await update(...args);
        f.parent.runtimeContext.architectureContext.executionCwd = '/root/other';
      });
    } else {
      f.executionProfiles.assertEnabled.mockImplementationOnce(async () => {
        f.parent.runtimeContext.architectureContext.executionCwd = '/root/other';
        return { id: 'saved-profile', model: 'swe-2' };
      });
    }
    await expect(f.prepare()).rejects.toThrow(/scope/);
    expect(f.vfs.assertProjectExecutionCwd).toHaveBeenLastCalledWith('/root', '/root/other');
  });
  it.each(['bootstrap', 'profile'] as const)('rejects a registry root changed during awaited %s despite unchanged project id', async stage => {
    const f = fixture();
    if (stage === 'bootstrap') {
      const update = f.sessions.updateRuntimeContext.getMockImplementation()!;
      f.sessions.updateRuntimeContext.mockImplementationOnce(async (...args) => { await update(...args); f.project.path = '/new-root'; });
    } else {
      f.executionProfiles.assertEnabled.mockImplementationOnce(async () => { f.project.path = '/new-root'; return { id: 'saved-profile', model: 'swe-2' }; });
    }
    await expect(f.prepare()).rejects.toThrow(/scope/);
    expect(f.projects.assertAssignable).toHaveBeenCalledTimes(2);
    expect(f.vfs.assertProjectExecutionCwd).toHaveBeenLastCalledWith('/new-root', '/root/src');
  });
  it('accepts equivalent persisted cwd spelling only after canonical authority revalidation', async () => {
    const f = fixture();
    f.vfs.assertProjectExecutionCwd.mockImplementation((root, cwd) => ({ projectRoot: root, cwd: cwd === '/root/src/../src' ? '/root/src' : cwd }));
    f.executionProfiles.assertEnabled.mockImplementationOnce(async () => { f.parent.runtimeContext.architectureContext.executionCwd = '/root/src/../src'; return { id: 'saved-profile', model: 'swe-2' }; });
    await f.prepare();
    expect(f.vfs.assertProjectExecutionCwd).toHaveBeenLastCalledWith('/root', '/root/src/../src');
  });
  it.each(['parent', 'project', 'profile'] as const)('rejects foreign child %s linkage before update', async field => {
    const f = fixture();
    if (field === 'parent') f.child.parentSessionId = 'other';
    if (field === 'project') f.child.projectId = 'other';
    if (field === 'profile') f.child.executionProfileId = 'other';
    await expect(f.prepare()).rejects.toThrow(/persisted parent/);
    expect(f.sessions.updateRuntimeContext).not.toHaveBeenCalled();
  });
  it('rejects a missing registry record rather than synthesizing a project', async () => {
    const f = fixture(); f.projects.assertAssignable.mockRejectedValueOnce(new Error('project missing'));
    await expect(f.prepare()).rejects.toThrow('project missing');
    expect(f.vfs.assertProjectExecutionCwd).not.toHaveBeenCalled();
  });
  it.each(['system', 'pathless', 'wrong-id'] as const)('rejects a %s registered project', async invalid => {
    const f = fixture(); f.projects.assertAssignable.mockResolvedValueOnce({ id: invalid === 'wrong-id' ? 'foreign' : 'project', kind: invalid === 'system' ? 'external' : 'workspace', path: invalid === 'pathless' ? '' : '/root' });
    await expect(f.prepare()).rejects.toThrow(/registered workspace/);
  });
  it('propagates canonical cwd rejection before bootstrap writes', async () => {
    const f = fixture(); f.vfs.assertProjectExecutionCwd.mockImplementationOnce(() => { throw new Error('outside registered scope'); });
    await expect(f.prepare()).rejects.toThrow('outside registered scope');
    expect(f.sessions.updateRuntimeContext).not.toHaveBeenCalled();
  });
  it('rejects a disabled persisted profile without substituting a persona/default profile', async () => {
    const f = fixture(); f.executionProfiles.assertEnabled.mockRejectedValueOnce(new Error('profile disabled'));
    await expect(f.prepare()).rejects.toThrow('profile disabled');
    expect(f.executionProfiles.assertEnabled.mock.calls).toEqual([['saved-profile']]);
  });
  it('rejects a resolved profile different from the persisted profile', async () => {
    const f = fixture(); f.executionProfiles.assertEnabled.mockResolvedValueOnce({ id: 'other', model: 'other-model' });
    await expect(f.prepare()).rejects.toThrow(/profile/);
  });
  it('returns the reloaded child context after update', async () => {
    const f = fixture(); const result = await f.prepare();
    expect(result.childSession.runtimeContext?.architectureContext).toEqual({ projectPath: '/root', executionCwd: '/root/src' });
    expect(result.childSession).toBe(f.child);
  });
  it('restores contained cwd after new session creation applies the project root', async () => {
    const f = fixture(); f.child.runtimeContext.architectureContext.executionCwd = '/root';
    const result = await f.prepare(true);
    expect(result.childSession.runtimeContext?.architectureContext?.['executionCwd']).toBe('/root/src');
  });
  it('fails closed if bootstrap update does not persist the authoritative scope', async () => {
    const f = fixture(); f.sessions.updateRuntimeContext.mockImplementationOnce(async () => undefined);
    await expect(f.prepare()).rejects.toThrow(/scope/);
  });
  it('rejects linkage changed during bootstrap update', async () => {
    const f = fixture(); f.sessions.updateRuntimeContext.mockImplementationOnce(async () => { f.child.executionProfileId = 'other'; });
    await expect(f.prepare()).rejects.toThrow(/persisted parent/);
  });
  it('rejects a repository response with a different parent identity', async () => {
    const f = fixture(); f.parent.id = 'foreign'; f.child.parentSessionId = 'foreign';
    await expect(f.resolve()).rejects.toThrow(/identity/);
  });
  it('rejects a repository response with a different child identity', async () => {
    const f = fixture(); f.child.id = 'foreign';
    await expect(f.resolve()).rejects.toThrow(/identity/);
  });
  it('rejects a persisted host linkage changed while resolving the profile', async () => {
    const f = fixture();
    f.executionProfiles.assertEnabled.mockImplementationOnce(async () => { f.parent.projectId = 'foreign'; return { id: 'saved-profile', model: 'swe-2' }; });
    await expect(f.prepare()).rejects.toThrow(/registered workspace|parent/);
  });
  it('preserves legacy anonymous-session bootstrap without a project/profile resolver', async () => {
    const sessions = { createWithId: vi.fn(async () => ({ id: 'anonymous-child', kind: 'subagent', parentSessionId: 'anonymous' })) };
    const result = await prepareSubagentExecution({ sessions: sessions as never, childSessionId: 'anonymous-child', parentSessionId: 'anonymous', personaId: 'default', objective: 'legacy', runtimeContext: { runtimeKind: 'subagent' } });
    expect(result.childSession.id).toBe('anonymous-child');
    expect(result.executionProfile).toBeUndefined();
  });
});
