import type { ArchitectureChatRunSummary, ChatMessage } from '@kalio/types';

export const finalAnswerLabels = { accepted: 'Accepted', blocked: 'Blocked', rejected: 'Rejected', incomplete: 'Incomplete' } as const;
type FinalAnswer = { status: keyof typeof finalAnswerLabels; blockingReason?: string; evidence: string[]; answer?: string; partial?: boolean };

export function parseFinalAnswer(content: string): FinalAnswer | null {
  try {
    const report = content.trim().replace(/^### Finalizer[ \t]*\r?\n\s*/, '');
    const raw: unknown = JSON.parse(report.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (typeof value.status !== 'string' || !Object.hasOwn(finalAnswerLabels, value.status)
      || !Array.isArray(value.evidence) || !value.evidence.every(item => typeof item === 'string')
      || (value.answer !== undefined && typeof value.answer !== 'string')
      || (value.blockingReason != null && typeof value.blockingReason !== 'string')) return null;
    return {
      status: value.status as FinalAnswer['status'],
      evidence: value.evidence,
      answer: typeof value.answer === 'string' ? value.answer : undefined,
      blockingReason: typeof value.blockingReason === 'string' ? value.blockingReason.trim() : undefined,
    };
  } catch {
    // TODO: legacy fallback — historical audit previews clipped final artifacts at 800 characters.
    if (content.length === 800) {
      const quoted = String.raw`"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"`;
      const prefix = new RegExp(`^\\{\\s*"status":\\s*("(?:accepted|blocked|rejected|incomplete)")\\s*,\\s*"blockingReason":\\s*(null|${quoted})\\s*,\\s*"evidence":\\s*\\[`).exec(content);
      if (prefix) {
        const remainder = content.slice(prefix[0].length);
        const complete = new RegExp(`^\\s*((?:${quoted}\\s*,\\s*)+)`).exec(remainder);
        const evidence = complete ? JSON.parse(`[${complete[1]!.trimEnd().slice(0, -1)}]`) as string[] : [];
        return { status: JSON.parse(prefix[1]!) as FinalAnswer['status'],
          blockingReason: JSON.parse(prefix[2]!) ?? undefined, evidence, partial: true };
      }
    }
    return null;
  }
}


/** Use the complete durable finalizer message when reload metadata contains only a preview. */
export function finalAnswerForArchitectureRun(
  run: Pick<ArchitectureChatRunSummary, 'runId' | 'finalArtifact' | 'trace'>,
  messages: readonly ChatMessage[],
): string | null {
  const finalizers = [...run.trace].reverse().filter((step) => step.speaker === 'finalizer');
  const completeArtifact = run.finalArtifact?.trim();
  const parsedArtifact = completeArtifact ? parseFinalAnswer(completeArtifact) : null;
  if (parsedArtifact && !parsedArtifact.partial) return run.finalArtifact!;
  for (const step of finalizers) {
    if (!step.eventId) continue;
    const message = messages.find((candidate) => candidate.role === 'assistant'
      && candidate.id === `architecture:${run.runId}:text:${step.eventId}`);
    const report = message ? parseFinalAnswer(message.content) : null;
    if (report && !report.partial) return message!.content;
  }
  return completeArtifact ? run.finalArtifact! : finalizers.find((step) => step.content?.trim())?.content?.trim() ?? null;
}
