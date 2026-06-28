import { useMemo } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import type { CLIChildProjection } from './cliChildProjection.model';
import {
  mergeCliOutput,
  selectCLIChildProjectionFromSources,
  resolveCLIChildProjectionStatus,
} from './cliChildProjection.model';
import { extractCLIAgentResult, extractCLIAgentSessionSnapshot } from './ToolCallBubble.parsers';
import type { ToolActivity } from '../../store/agentStore';

export function useCLIChildProjection(
  childSessionId: string | undefined,
  parentCallId: string | undefined,
): CLIChildProjection | null {
  const runtimeActivitySnapshots = useAgentStore((state) => state.runtimeActivitySnapshots);
  const cliChildProjections = useAgentStore((state) => state.cliChildProjections);

  return useMemo(() => selectCLIChildProjectionFromSources({
    runtimeActivitySnapshots,
    cliChildProjections,
    childSessionId,
    parentCallId,
  }), [childSessionId, cliChildProjections, parentCallId, runtimeActivitySnapshots]);
}

export function useCLIChildLiveOutput(parentCallId: string | undefined): string {
  const liveOutput = useAgentStore((state) => (
    parentCallId ? state.cliAgentOutput[parentCallId] ?? '' : ''
  ));
  return liveOutput;
}

export function useCLIChildCardState(params: {
  activity?: ToolActivity;
  toolName: string;
  parentSessionId: string;
  parentCallId: string;
  resultData?: unknown;
  childSessionId?: string;
}): {
  projection: CLIChildProjection | null;
  liveOutput: string;
  childTitle: string;
  status: CLIChildProjection['status'];
} {
  const sessions = useSessionStore((state) => state.sessions);
  const projectionState = useCLIChildProjection(params.childSessionId, params.parentCallId);
  const liveOutput = useCLIChildLiveOutput(params.parentCallId);

  const snapshot = params.resultData != null ? extractCLIAgentSessionSnapshot(params.resultData) : null;
  const cliResult = params.resultData != null ? extractCLIAgentResult(params.resultData) : null;
  const resolvedChildSessionId = params.childSessionId
    ?? snapshot?.childSessionId
    ?? cliResult?.childSessionId
    ?? projectionState?.childSessionId;

  const childSession = sessions.find((session) => session.id === resolvedChildSessionId);
  const activityStatus = params.activity?.status;
  const agentId = snapshot?.agentId
    ?? cliResult?.agentId
    ?? projectionState?.agentId
    ?? (params.activity?.args['agentId'] as string | undefined)
    ?? 'copilot';

  const status = resolveCLIChildProjectionStatus({
    snapshotStatus: snapshot?.status,
    liveProjectionStatus: projectionState?.status,
    activityStatus,
    cliResult,
  });

  const projection = useMemo((): CLIChildProjection | null => {
    if (!resolvedChildSessionId) {
      if (activityStatus === 'running') {
        return {
          childSessionId: projectionState?.childSessionId ?? `pending-${params.parentCallId}`,
          parentSessionId: params.parentSessionId,
          parentCallId: params.parentCallId,
          agentId,
          status: 'running',
          lastOutput: liveOutput,
          childTitle: childSession?.title ?? projectionState?.childTitle,
          toolName: params.toolName,
          isPending: true,
        };
      }
      return projectionState;
    }
    return {
      childSessionId: resolvedChildSessionId,
      parentSessionId: params.parentSessionId,
      parentCallId: params.parentCallId,
      agentId,
      status,
      lastOutput: mergeCliOutput(
        projectionState ?? {
          childSessionId: resolvedChildSessionId,
          parentSessionId: params.parentSessionId,
          parentCallId: params.parentCallId,
          agentId,
          status,
          lastOutput: '',
          toolName: params.toolName,
        },
        liveOutput,
        snapshot,
        cliResult,
      ),
      childTitle: childSession?.title ?? projectionState?.childTitle,
      toolName: params.toolName,
      isPending: projectionState?.isPending === true && !childSession,
    };
  }, [
    agentId,
    activityStatus,
    childSession?.title,
    cliResult,
    liveOutput,
    params.parentCallId,
    params.parentSessionId,
    params.toolName,
    resolvedChildSessionId,
    snapshot,
    status,
    projectionState,
  ]);

  return {
    projection,
    liveOutput: projection?.lastOutput ?? liveOutput,
    childTitle: childSession?.title ?? projection?.childTitle ?? `${agentId} CLI`,
    status,
  };
}
