import type { ArchitectureExecutionEvent, ArchitectureRoleSlot } from '@kalio/types';

type SummarySlotType = ArchitectureRoleSlot['slotType'];

const DEFAULT_MAX_MESSAGE_LENGTH = 700;
const FINALIZER_MAX_MESSAGE_LENGTH = 360;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function compactRecursivePromptEcho(value: string): string {
  let compacted = value;
  for (const marker of [
    /\n\s*Incoming graph outputs:\s*/i,
    /\n\s*Available next nodes:\s*/i,
    /\n\s*Context:\s*/i,
  ]) {
    compacted = compacted.split(marker)[0] ?? compacted;
  }
  return compacted;
}

function routerOutputSummary(event: ArchitectureExecutionEvent): string | undefined {
  const routerOutput = isRecord(event.routerOutput)
    ? event.routerOutput
    : isRecord(event.data) && isRecord(event.data['routerOutput'])
      ? event.data['routerOutput']
      : undefined;
  if (!routerOutput) {
    return undefined;
  }

  const selectedStrategy = firstString(routerOutput['selectedStrategy']) ?? 'unknown strategy';
  const mergedDecision = firstString(routerOutput['mergedDecision']) ?? event.message;
  const nextAction = firstString(routerOutput['nextAction']);
  const acceptedCount = Array.isArray(routerOutput['acceptedInputs']) ? routerOutput['acceptedInputs'].length : 0;
  const rejectedCount = Array.isArray(routerOutput['rejectedInputs']) ? routerOutput['rejectedInputs'].length : 0;
  const confidence = typeof routerOutput['confidence'] === 'number'
    ? ` confidence=${Math.round(routerOutput['confidence'] * 100)}%`
    : '';
  const action = nextAction ? ` next=${nextAction}` : '';

  return `${selectedStrategy}: ${mergedDecision} [accepted=${acceptedCount}, rejected=${rejectedCount}${confidence}${action}]`;
}

export function summarizeArchitectureIncomingEvent(
  event: ArchitectureExecutionEvent,
  slotType: SummarySlotType,
): string {
  const maxLength = slotType === 'finalizer'
    ? FINALIZER_MAX_MESSAGE_LENGTH
    : DEFAULT_MAX_MESSAGE_LENGTH;
  const routerSummary = routerOutputSummary(event);
  if (routerSummary) {
    return truncate(routerSummary, maxLength);
  }

  return truncate(compactRecursivePromptEcho(event.message), maxLength);
}
