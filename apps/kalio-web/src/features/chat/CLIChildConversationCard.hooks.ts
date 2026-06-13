import { useMemo } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import type { CLIChildProjection } from './cliChildProjection.model';
import { mergeCliOutput, resolveCLIChildProjectionStatus } from './cliChildProjection.model';
import { extractCLIAgentResult, extractCLIAgentSessionSnapshot } from './ToolCallBubble.parsers';
import type { ToolActivity } from '../../store/agentStore';

export function useCLIChildProjection(
  childSessionId: string | undefined,
  parentCallId: string | undefined,
): CLIChildProjection | null {
  const projection = useAgentStore((state) => (
    childSessionId ? state.cliChildProjections[childSessionId] : undefined
  ));
  const byCallId = useAgentStore((state) => {
    if (!parentCallId) return undefined;
    return Object.values(state.cliChildProjections).find((item) => item.parentCallId === parentCallId);
  });
  return projection ?? byCallId ?? null;
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
  const storedProjection = useCLIChildProjection(params.childSessionId, params.parentCallId);
  const liveOutput = useCLIChildLiveOutput(params.parentCallId);

  const snapshot = params.resultData != null ? extractCLIAgentSessionSnapshot(params.resultData) : null;
  const cliResult = params.resultData != null ? extractCLIAgentResult(params.resultData) : null;
  const resolvedChildSessionId = params.childSessionId
    ?? snapshot?.childSessionId
    ?? cliResult?.childSessionId
    ?? storedProjection?.childSessionId;

  const childSession = sessions.find((session) => session.id === resolvedChildSessionId);
  const activityStatus = params.activity?.status;
  const agentId = snapshot?.agentId
    ?? cliResult?.agentId
    ?? storedProjection?.agentId
    ?? (params.activity?.args['agentId'] as string | undefined)
    ?? 'copilot';

  const status = resolveCLIChildProjectionStatus({
    snapshotStatus: snapshot?.status,
    liveProjectionStatus: storedProjection?.status,
    activityStatus,
    cliResult,
  });

  const projection = useMemo((): CLIChildProjection | null => {
    if (!resolvedChildSessionId) {
      if (activityStatus === 'running') {
        return {
          childSessionId: storedProjection?.childSessionId ?? `pending-${params.parentCallId}`,
          parentSessionId: params.parentSessionId,
          parentCallId: params.parentCallId,
          agentId,
          status: 'running',
          lastOutput: liveOutput,
          childTitle: childSession?.title ?? storedProjection?.childTitle,
          toolName: params.toolName,
        };
      }
      return storedProjection;
    }
    return {
      childSessionId: resolvedChildSessionId,
      parentSessionId: params.parentSessionId,
      parentCallId: params.parentCallId,
      agentId,
      status,
      lastOutput: mergeCliOutput(
        storedProjection ?? {
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
      childTitle: childSession?.title ?? storedProjection?.childTitle,
      toolName: params.toolName,
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
    storedProjection,
  ]);

  return {
    projection,
    liveOutput: projection?.lastOutput ?? liveOutput,
    childTitle: childSession?.title ?? projection?.childTitle ?? `${agentId} CLI`,
    status,
  };
}
