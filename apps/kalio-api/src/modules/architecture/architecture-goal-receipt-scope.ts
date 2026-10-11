import type { ChatSession, ExecutionProfile, Project } from '@kalio/types';
import type { GoalReceiptProducerPorts, GoalReceiptScopeKey } from './architecture-goal-receipt-producer';

interface ScopePorts {
  sessions: { get(id: string): Promise<ChatSession> };
  projects: { assertAssignable(id: string): Promise<Project> };
  profiles: { assertEnabled(id: string): Promise<ExecutionProfile> };
  vfs: { assertProjectExecutionCwd(root: string, cwd: string): { projectRoot: string; cwd: string } };
}
const invalid = (): never => { throw new Error('GOAL_RECEIPT_SCOPE_INVALID'); };

/** Host composition only. No request context or model-provided cwd is authority. */
export function createGoalReceiptScopeReader(ports: ScopePorts): GoalReceiptProducerPorts['persistedScope'] {
  async function read(key: GoalReceiptScopeKey) {
    const root = await ports.sessions.get(key.rootSessionId);
    if (root.id !== key.rootSessionId || root.projectId !== key.projectId
      || root.executionProfileId !== key.executionProfileId) return invalid();
    const persistedCwd = root.runtimeContext?.architectureContext?.['executionCwd'];
    if (persistedCwd !== undefined && (typeof persistedCwd !== 'string' || !persistedCwd.trim())) return invalid();
    const child = await ports.sessions.get(key.branchSessionId);
    if (child.id !== key.branchSessionId || child.kind !== 'subagent'
      || child.parentSessionId !== key.rootSessionId || child.projectId !== key.projectId
      || child.executionProfileId !== key.executionProfileId) return invalid();
    const project = await ports.projects.assertAssignable(key.projectId);
    if (project.id !== key.projectId || project.kind !== 'workspace' || !project.path?.trim()) return invalid();
    const path = project.path;
    const profile = await ports.profiles.assertEnabled(key.executionProfileId);
    if (profile.id !== key.executionProfileId) return invalid();
    const canonical = ports.vfs.assertProjectExecutionCwd(path, typeof persistedCwd === 'string' ? persistedCwd : path);
    // Resolve fresh persisted rows after the final asynchronous profile lookup.
    // Bootstrap writes these exact canonical fields; absent branch scope is not authority.
    const [freshRoot, freshChild] = await Promise.all([
      ports.sessions.get(key.rootSessionId), ports.sessions.get(key.branchSessionId),
    ]);
    if (freshRoot.id !== key.rootSessionId || freshRoot.projectId !== key.projectId
      || freshRoot.executionProfileId !== key.executionProfileId
      || freshRoot.runtimeContext?.architectureContext?.['executionCwd'] !== persistedCwd
      || freshChild.id !== key.branchSessionId || freshChild.kind !== 'subagent'
      || freshChild.parentSessionId !== key.rootSessionId || freshChild.projectId !== key.projectId
      || freshChild.executionProfileId !== key.executionProfileId
      || freshChild.runtimeContext?.architectureContext?.['projectPath'] !== canonical.projectRoot
      || freshChild.runtimeContext?.architectureContext?.['executionCwd'] !== canonical.cwd) return invalid();
    return { ...key, parentSessionId: key.rootSessionId,
      canonicalProjectRoot: canonical.projectRoot, canonicalCwd: canonical.cwd };
  }
  return {
    async readRegisteredScope(key) {
      // A second persisted read detects changes across asynchronous registry/profile resolution.
      // This is observation, not a workspace lock; producer rechecks before each dispatch.
      const expected = await read(key);
      const current = await read(key);
      if (current.canonicalProjectRoot !== expected.canonicalProjectRoot || current.canonicalCwd !== expected.canonicalCwd) return invalid();
      return current;
    },
  };
}
