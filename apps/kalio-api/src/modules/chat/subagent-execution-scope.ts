import type { ChatSession } from '@kalio/types';
import type { ExecutionProfileService } from '../agent-runtime/execution-profile.service';
import type { VFSService } from '../vfs/vfs.service';
import type { ProjectsService } from './projects.service';
import type { SessionsService } from './sessions.service';
import { readExecutionCwd } from './chat-input.helpers';
import { ensureSubagentSession } from './subagent-session-bootstrap';

function assertChildLinkage(parent: ChatSession, child: ChatSession): void {
  if (child.kind !== 'subagent' || child.parentSessionId !== parent.id
    || child.projectId !== parent.projectId || child.executionProfileId !== parent.executionProfileId) {
    throw new Error('Host receipt child must match its persisted parent, project and execution profile.');
  }
}

async function readObservedSubagentScope(input: {
  sessions: SessionsService; projects?: ProjectsService; vfs: VFSService;
  parentSessionId: string; childSessionId?: string;
}) {
  if (!input.projects) throw new Error('Host receipt execution requires the project registry.');
  const parent = { ...await input.sessions.get(input.parentSessionId) };
  if (parent.id !== input.parentSessionId) throw new Error('Host receipt parent identity mismatch.');
  if (!parent.projectId || !parent.executionProfileId?.trim()) throw new Error('Host receipt execution requires a persisted project and profile.');
  const project = await input.projects.assertAssignable(parent.projectId);
  if (project.id !== parent.projectId || project.kind !== 'workspace' || !project.path?.trim()) {
    throw new Error('Host receipt execution requires a registered workspace project root.');
  }
  if (input.childSessionId) {
    const child = await input.sessions.get(input.childSessionId);
    if (child.id !== input.childSessionId) throw new Error('Host receipt child identity mismatch.');
    assertChildLinkage(parent, child);
  }
  // Only the persisted parent's cwd can narrow the registered root; request context is not authority.
  return { parent, ...input.vfs.assertProjectExecutionCwd(project.path, readExecutionCwd(parent.runtimeContext) ?? project.path) };
}

export async function resolveObservedSubagentScope(input: Parameters<typeof readObservedSubagentScope>[0]) {
  const scope = await readObservedSubagentScope(input);
  return {
    ...scope,
    // Host-only closure retains the original authorities, never model/context configuration.
    revalidate: async (): Promise<void> => {
      const current = await readObservedSubagentScope(input);
      if (current.parent.id !== scope.parent.id || current.parent.projectId !== scope.parent.projectId
        || current.parent.executionProfileId !== scope.parent.executionProfileId) {
        throw new Error('Host receipt persisted parent linkage changed during bootstrap.');
      }
      if (current.projectRoot !== scope.projectRoot || current.cwd !== scope.cwd) {
        throw new Error('Host receipt canonical project execution scope changed during bootstrap.');
      }
    },
  };
}

export async function prepareSubagentExecution(input: Parameters<typeof ensureSubagentSession>[0] & {
  executionProfiles?: ExecutionProfileService;
  observedScope?: Awaited<ReturnType<typeof resolveObservedSubagentScope>>;
}) {
  const childSession = await ensureSubagentSession({ ...input, reloadAfterUpdate: Boolean(input.observedScope) });
  if (input.observedScope) {
    assertChildLinkage(input.observedScope.parent, childSession);
    if (!input.executionProfiles) throw new Error('Host receipt execution requires persisted execution profile resolution.');
    const context = childSession.runtimeContext?.architectureContext;
    if (context?.['projectPath'] !== input.observedScope.projectRoot || context?.['executionCwd'] !== input.observedScope.cwd) {
      throw new Error('Host receipt bootstrap did not persist the authoritative project scope.');
    }
  }
  const executionProfile = input.executionProfiles
    ? await input.executionProfiles.assertEnabled(childSession.executionProfileId ?? '') : undefined;
  if (input.observedScope && executionProfile?.id !== childSession.executionProfileId) {
    throw new Error('Host receipt execution profile does not match the persisted profile.');
  }
  if (input.observedScope) {
    await input.observedScope.revalidate();
    if (childSession.id !== input.childSessionId) throw new Error('Host receipt child identity mismatch.');
  }
  return { childSession, executionProfile };
}
