import type { ArchitectureExecutionEvent, ArchitectureRoleSlot } from '@kalio/types';

type SummarySlotType = ArchitectureRoleSlot['slotType'];

const DEFAULT_MAX_MESSAGE_LENGTH = 900;
const FINALIZER_MAX_MESSAGE_LENGTH = 700;
const MAX_ROUTER_INSIGHT_LENGTH = 180;
const MAX_ROUTER_LIST_ITEMS = 3;
const MAX_HANDOFF_FIELD_LENGTH = 220;

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
  const response = firstString(routerOutput['response']);
  const nextAction = firstString(routerOutput['nextAction']);
  const targetNodeId = firstString(routerOutput['targetNodeId']);
  const acceptedCount = Array.isArray(routerOutput['acceptedInputs']) ? routerOutput['acceptedInputs'].length : 0;
  const rejectedCount = Array.isArray(routerOutput['rejectedInputs']) ? routerOutput['rejectedInputs'].length : 0;
  const confidence = typeof routerOutput['confidence'] === 'number'
    ? ` confidence=${Math.round(routerOutput['confidence'] * 100)}%`
    : '';
  const action = nextAction ? ` next=${nextAction}${targetNodeId ? `:${targetNodeId}` : ''}` : '';
  const details = [
    routerInsightList('accepted', routerOutput['acceptedInputs']),
    routerInsightList('rejected', routerOutput['rejectedInputs']),
    routerStringList('conflicts', routerOutput['unresolvedConflicts']),
    routerRiskList(routerOutput['risks']),
    response ? `handoff=${truncate(response, MAX_ROUTER_INSIGHT_LENGTH)}` : undefined,
  ].filter((value): value is string => Boolean(value));

  return [
    `${selectedStrategy}: ${mergedDecision}`,
    `[accepted=${acceptedCount}, rejected=${rejectedCount}${confidence}${action}]`,
    ...details,
  ].join(' ');
}

function routerInsightList(label: string, value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const items = value
    .slice(0, MAX_ROUTER_LIST_ITEMS)
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const fromSlot = firstString(item['fromSlot']) ?? 'unknown';
      const insight = firstString(item['insight']);
      const why = firstString(item['whyAccepted']) ?? firstString(item['whyRejected']);
      if (!insight) {
        return null;
      }
      return `${fromSlot}: ${truncate(`${insight}${why ? ` (${why})` : ''}`, MAX_ROUTER_INSIGHT_LENGTH)}`;
    })
    .filter((item): item is string => Boolean(item));
  if (items.length === 0) {
    return undefined;
  }
  return `${label}=${items.join(' | ')}`;
}

function routerStringList(label: string, value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, MAX_ROUTER_LIST_ITEMS)
    .map((item) => truncate(item, MAX_ROUTER_INSIGHT_LENGTH));
  return items.length > 0 ? `${label}=${items.join(' | ')}` : undefined;
}

function routerRiskList(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const items = value
    .slice(0, MAX_ROUTER_LIST_ITEMS)
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const risk = firstString(item['risk']);
      const mitigation = firstString(item['mitigation']);
      if (!risk) {
        return null;
      }
      return truncate(`${risk}${mitigation ? ` -> ${mitigation}` : ''}`, MAX_ROUTER_INSIGHT_LENGTH);
    })
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? `risks=${items.join(' | ')}` : undefined;
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

export function summarizeArchitectureIncomingHandoffPacket(
  event: ArchitectureExecutionEvent,
): string | undefined {
  const routerOutput = routerOutputForEvent(event);
  if (!routerOutput) {
    return undefined;
  }

  const source = event.roleSlotId ?? event.nodeId ?? event.type;
  const target = firstString(routerOutput['targetNodeId'])
    ?? event.route?.nextNodeId
    ?? firstString(routerOutput['nextAction'])
    ?? 'unknown';
  const action = firstString(routerOutput['nextAction']) ?? 'unknown';
  const confidence = typeof routerOutput['confidence'] === 'number' && Number.isFinite(routerOutput['confidence'])
    ? ` confidence=${Math.round(routerOutput['confidence'] * 100)}%`
    : '';
  const response = firstString(routerOutput['response']) ?? firstString(routerOutput['mergedDecision']);
  const details = [
    response ? `response=${truncate(response, MAX_HANDOFF_FIELD_LENGTH)}` : undefined,
    handoffInsightList('accepted', routerOutput['acceptedInputs']),
    handoffInsightList('rejected', routerOutput['rejectedInputs']),
    handoffStringList('conflicts', routerOutput['unresolvedConflicts']),
    handoffRiskList(routerOutput['risks']),
  ].filter((value): value is string => Boolean(value));

  return [
    `from=${source} target=${target} action=${action}${confidence}`,
    ...details,
  ].join(' ');
}

function routerOutputForEvent(event: ArchitectureExecutionEvent): Record<string, unknown> | undefined {
  if (isRecord(event.routerOutput)) {
    return event.routerOutput;
  }
  return isRecord(event.data) && isRecord(event.data['routerOutput'])
    ? event.data['routerOutput']
    : undefined;
}

function handoffInsightList(label: string, value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const items = value
    .slice(0, MAX_ROUTER_LIST_ITEMS)
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const fromSlot = firstString(item['fromSlot']) ?? 'unknown';
      const insight = firstString(item['insight']);
      const why = firstString(item['whyAccepted']) ?? firstString(item['whyRejected']);
      if (!insight) {
        return null;
      }
      return `${fromSlot}: ${truncate(`${insight}${why ? ` (${why})` : ''}`, MAX_HANDOFF_FIELD_LENGTH)}`;
    })
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? `${label}=${items.join(' | ')}` : undefined;
}

function handoffStringList(label: string, value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, MAX_ROUTER_LIST_ITEMS)
    .map((item) => truncate(item, MAX_HANDOFF_FIELD_LENGTH));
  return items.length > 0 ? `${label}=${items.join(' | ')}` : undefined;
}

function handoffRiskList(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const items = value
    .slice(0, MAX_ROUTER_LIST_ITEMS)
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const sourceSlot = firstString(item['sourceSlot']) ?? 'unknown';
      const risk = firstString(item['risk']);
      const mitigation = firstString(item['mitigation']);
      if (!risk) {
        return null;
      }
      return `${sourceSlot}: ${truncate(`${risk}${mitigation ? ` -> ${mitigation}` : ''}`, MAX_HANDOFF_FIELD_LENGTH)}`;
    })
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? `risks=${items.join(' | ')}` : undefined;
}
