import type { CLIChildProjection } from './cliChildProjection.model';
import { CLIChildConversationCard } from './CLIChildConversationCard';

export interface CliChildCanvasPreview extends CLIChildProjection {
  childTitle: string;
}

export function buildCliChildPreviews(
  parentSessionId: string | null,
  projections: Record<string, CLIChildProjection>,
  sessionTitles: Map<string, string>,
): CliChildCanvasPreview[] {
  if (!parentSessionId) return [];
  return Object.values(projections)
    .filter((projection) => projection.parentSessionId === parentSessionId)
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
