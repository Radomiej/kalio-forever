import type { RunSubAgentFlowArgs } from '@kalio/types';
import type { SessionsService } from '../chat/sessions.service';
import type { ArchitectureRuntimeService } from '../architecture/architecture-runtime.service';

const ALLOWANCE_CONTEXT_KEYS = [
  'projectPath',
  'executionCwd',
  'launchAllowedToolNames',
  'allowArchitectureOrchestratorSubagents',
  'autoApproveArchitectureProjectWrites',
  'autoApproveArchitectureTerminal',
  'allowArchitectureCliStop',
  'architectureCliAgentsEnabled',
  'availableCliAgents',
  'cliAgentToolPreferences',
  'requireGoalMasterLoopProof',
  'requireImplementerWriteProof',
  'maxArchitectureSteps',
  'maxArchitectureNodeVisits',
  'maxArchitectureSubagentIterations',
  'maxArchitectureIdleMs',
  'hydrateFromSessionId',
  'hydrateFilePaths',
  'hydrateTargetPrefix',
  'orchestratorScopeRestriction',
] as const;

const BLOCKED_LAUNCH_KEYS = new Set([
  'parentSessionId',
  'parentToolCallId',
  'subAgentFlow',
  'resumeContext',
  'resumeInput',
  'subAgentFlowContinuation',
  'goal',
  'flowId',
]);

export interface AgentFlowLaunchContextDeps {
  sessions: Pick<SessionsService, 'get'>;
  architectureRuntime: Pick<ArchitectureRuntimeService, 'findRunDurable'>;
}

export function extractAllowanceContext(
  source: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!source) return {};
  const extracted: Record<string, unknown> = {};
  for (const key of ALLOWANCE_CONTEXT_KEYS) {
    if (key in source) {
      extracted[key] = source[key];
    }
  }
  return extracted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLaunchContext(
  launchContext: RunSubAgentFlowArgs['context'],
): Record<string, unknown> | undefined {
  if (launchContext === undefined) return undefined;
  if (typeof launchContext === 'string') {
    const trimmed = launchContext.trim();
    return trimmed.length > 0 ? { subAgentFlowContext: trimmed } : undefined;
  }
  if (!isRecord(launchContext)) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(launchContext)) {
    if (!BLOCKED_LAUNCH_KEYS.has(key)) {
      sanitized[key] = value;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function mergeAllowanceRecords(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) {
      target[key] = value;
    }
  }
}

function parseArchitectureRunIdFromRootSession(sessionId: string): string | undefined {
  const prefix = 'arch-';
  const suffix = '-root';
  if (!sessionId.startsWith(prefix) || !sessionId.endsWith(suffix)) {
    return undefined;
  }
  const runId = sessionId.slice(prefix.length, -suffix.length);
  return runId.length > 0 ? runId : undefined;
}

function isOrchestratorRestricted(context: Record<string, unknown> | undefined): boolean {
  const restriction = context?.['orchestratorScopeRestriction'];
  return restriction === true
    || (isRecord(restriction) && Object.keys(restriction).length > 0);
}

export function mergeAgentFlowLaunchContext(input: {
  baseline: Record<string, unknown>;
  launchContext?: RunSubAgentFlowArgs['context'];
}): Record<string, unknown> | undefined {
  const explicit = normalizeLaunchContext(input.launchContext);
  const merged: Record<string, unknown> = { ...input.baseline };

  if (explicit) {
    for (const [key, value] of Object.entries(explicit)) {
      if (!BLOCKED_LAUNCH_KEYS.has(key)) {
        merged[key] = value;
      }
    }
  }

  if (explicit && isOrchestratorRestricted(explicit)) {
    if ('projectPath' in explicit) {
      merged['projectPath'] = explicit['projectPath'];
    }
    if ('executionCwd' in explicit) {
      merged['executionCwd'] = explicit['executionCwd'];
    }
    if (explicit['allowArchitectureOrchestratorSubagents'] === false) {
      merged['allowArchitectureOrchestratorSubagents'] = false;
    }
    if (explicit['architectureCliAgentsEnabled'] === false) {
      merged['architectureCliAgentsEnabled'] = false;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export async function resolveParentAllowanceBaseline(
  parentSessionId: string,
  deps: AgentFlowLaunchContextDeps,
): Promise<Record<string, unknown>> {
  const baseline: Record<string, unknown> = {};
  const visited = new Set<string>();
  let currentSessionId: string | undefined = parentSessionId;

  while (currentSessionId && !visited.has(currentSessionId)) {
    visited.add(currentSessionId);
    try {
      const session = await deps.sessions.get(currentSessionId);
      mergeAllowanceRecords(
        baseline,
        extractAllowanceContext(session.runtimeContext?.architectureContext),
      );

      const architectureRunId = parseArchitectureRunIdFromRootSession(currentSessionId);
      if (architectureRunId) {
        const run = await deps.architectureRuntime.findRunDurable(architectureRunId);
        mergeAllowanceRecords(baseline, extractAllowanceContext(run?.context));
      }

      currentSessionId = session.parentSessionId;
    } catch {
      break;
    }
  }

  return baseline;
}

export async function resolveEffectiveAgentFlowContext(
  parentSessionId: string,
  launchContext: RunSubAgentFlowArgs['context'],
  deps: AgentFlowLaunchContextDeps,
): Promise<RunSubAgentFlowArgs['context']> {
  const baseline = await resolveParentAllowanceBaseline(parentSessionId, deps);
  return mergeAgentFlowLaunchContext({ baseline, launchContext });
}
