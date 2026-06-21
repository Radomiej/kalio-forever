import type { RuntimeChildExecution } from '@kalio/types';
import {
  type CLIChildProjection,
  mergeCLIChildProjectionSources,
  projectionFromRuntimeChildExecution,
} from './cliChildProjection.model';
import { CLIChildConversationCard } from './CLIChildConversationCard';

export interface CliChildCanvasPreview extends CLIChildProjection {
  childTitle: string;
}

export function buildCliChildPreviews(
  parentSessionId: string | null,
  projections: Record<string, CLIChildProjection>,
  childExecutionsOrSessionTitles: RuntimeChildExecution[] | Map<string, string>,
  sessionTitlesArg?: Map<string, string>,
): CliChildCanvasPreview[] {
  if (!parentSessionId) return [];
  // TODO: legacy fallback - preserve older helper call sites/tests that passed sessionTitles as the third arg.
  const childExecutions = Array.isArray(childExecutionsOrSessionTitles) ? childExecutionsOrSessionTitles : [];
  const sessionTitles = childExecutionsOrSessionTitles instanceof Map
    ? childExecutionsOrSessionTitles
    : (sessionTitlesArg ?? new Map<string, string>());
  const merged = new Map<string, CLIChildProjection>();
  childExecutions
    .map((execution) => projectionFromRuntimeChildExecution(execution))
    .filter((projection): projection is CLIChildProjection => projection !== null)
    .filter((projection) => projection.parentSessionId === parentSessionId)
    .forEach((projection) => {
      merged.set(projection.childSessionId, projection);
    });
  Object.values(projections)
    .filter((projection) => projection.parentSessionId === parentSessionId)
    .forEach((projection) => {
      merged.set(
        projection.childSessionId,
        mergeCLIChildProjectionSources({
          runtimeProjection: merged.get(projection.childSessionId),
          storedProjection: projection,
        }) ?? projection,
      );
    });

  return [...merged.values()]
    .filter((projection) => sessionTitles.has(projection.childSessionId))
    .map((projection) => ({
      ...projection,
      childTitle: sessionTitles.get(projection.childSessionId) ?? projection.childTitle ?? `${projection.agentId} CLI`,
    }))
    .sort((left, right) => left.childSessionId.localeCompare(right.childSessionId));
}

export function CliChildConversationCanvasCard({
  preview,
  onOpen,
}: {
  preview: CliChildCanvasPreview;
  onOpen: () => void;
}) {
  return (
    <CLIChildConversationCard
      toolName={preview.toolName}
      parentSessionId={preview.parentSessionId}
      parentCallId={preview.parentCallId}
      childSessionId={preview.childSessionId}
      resultData={{
        childSessionId: preview.childSessionId,
        parentSessionId: preview.parentSessionId,
        agentId: preview.agentId,
        status: preview.status,
        lastOutput: preview.lastOutput,
      }}
      onInspect={onOpen}
    />
  );
}
