import type { ArchitectureSchema, ChatMessage, ChatSession } from '@kalio/types';
import type { ArchitectureRegistryService } from './architecture-registry.service';
import { parseJsonObject, stringField } from './architecture-durable-graph.utils';

export function sessionReferencesArchitectureRun(session: ChatSession, runId: string): boolean {
  return session.runtimeContext?.architectureContext?.architectureRunId === runId
    || architectureSessionReferencesRun(session.id, runId)
    || architectureSessionReferencesRun(session.parentSessionId, runId);
}

export function messageReferencesArchitectureRun(message: ChatMessage, runId: string): boolean {
  if (message.architectureRun?.runId === runId) {
    return true;
  }

  if (
    architectureMessageIdReferencesRun(message.id, runId)
    || architectureMessageIdReferencesRun(message.toolCallId, runId)
    || architectureSessionReferencesRun(message.sessionId, runId)
  ) {
    return true;
  }

  if (message.toolCalls?.some((toolCall) => toolCall.args['architectureRunId'] === runId)) {
    return true;
  }

  const snapshot = parseJsonObject(message.content);
  return snapshot?.['architectureRunId'] === runId
    || snapshot?.['runId'] === runId
    || architectureSessionReferencesRun(stringField(snapshot ?? {}, 'parentSessionId'), runId)
    || architectureSessionReferencesRun(stringField(snapshot ?? {}, 'sessionId'), runId);
}

export function inferParentsBySessionId(
  schema: ArchitectureSchema,
  messages: ChatMessage[],
): Map<string, { nodeId?: string; roleSlotId?: string }> {
  const parents = new Map<string, { nodeId?: string; roleSlotId?: string }>();
  for (const message of messages) {
    if (!message.content) {
      continue;
    }
    const parent = inferParentFromLegacyPrompt(schema, message.content);
    if (parent) {
      parents.set(message.sessionId, parent);
    }
  }
  return parents;
}

export function schemaForPersistedRun(
  schemaId: string | undefined,
  messages: ChatMessage[],
  registry: ArchitectureRegistryService,
): ArchitectureSchema | null {
  if (schemaId) {
    const schema = registry.findOne(schemaId);
    if (schema) {
      return schema;
    }
  }

  const toolCallSchemaId = messages
    .flatMap((message) => message.toolCalls ?? [])
    .map((toolCall) => toolCall.args['schemaId'])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim();
  if (toolCallSchemaId) {
    const schema = registry.findOne(toolCallSchemaId);
    if (schema) {
      return schema;
    }
  }

  const toolCallSchemaName = messages
    .flatMap((message) => message.toolCalls ?? [])
    .map((toolCall) => toolCall.args['schemaName'])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim();
  return toolCallSchemaName
    ? schemaByNameOrId(registry, toolCallSchemaName)
    : legacySchemaFromPromptHeader(messages, registry);
}

function architectureMessageIdReferencesRun(value: string | undefined, runId: string): boolean {
  return typeof value === 'string' && value.startsWith(`architecture:${runId}:`);
}

function architectureSessionReferencesRun(value: string | undefined, runId: string): boolean {
  return typeof value === 'string' && (
    value === `arch-${runId}-root`
    || value.startsWith(`arch-${runId}-`)
  );
}

function inferParentFromLegacyPrompt(
  schema: ArchitectureSchema,
  content: string,
): { nodeId?: string; roleSlotId?: string } | null {
  // TODO: legacy fallback - older branch prompts persisted only a human-readable Slot header.
  const slotName = /^Slot:\s*([^\n(]+)/im.exec(content)?.[1]?.trim();
  if (!slotName) {
    return null;
  }
  const normalizedSlotName = normalizeLegacyIdentifier(slotName);
  const node = schema.nodes.find((candidate) => (
    normalizeLegacyIdentifier(candidate.id) === normalizedSlotName
    || normalizeLegacyIdentifier(candidate.roleSlotId ?? '') === normalizedSlotName
    || normalizeLegacyIdentifier(candidate.label) === normalizedSlotName
  ));
  if (!node) {
    return null;
  }
  return {
    nodeId: node.id,
    roleSlotId: node.roleSlotId,
  };
}

function legacySchemaFromPromptHeader(
  messages: ChatMessage[],
  registry: ArchitectureRegistryService,
): ArchitectureSchema | null {
  // TODO: legacy fallback - old architecture parent/branch messages stored schema identity only in prompt headers.
  for (const message of messages) {
    const schemaLabel = architectureHeaderValue(message.content);
    if (!schemaLabel) {
      continue;
    }
    const schema = schemaByNameOrId(registry, schemaLabel);
    if (schema) {
      return schema;
    }
  }
  return null;
}

function architectureHeaderValue(content: string): string | null {
  const bracketMatch = /^\s*\[Architecture:\s*([^\]]+)\]/im.exec(content);
  const lineMatch = /^\s*Architecture:\s*(.+)$/im.exec(content);
  const raw = (bracketMatch?.[1] ?? lineMatch?.[1])?.trim();
  if (!raw) {
    return null;
  }
  return raw.replace(/\s+v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?$/i, '').trim();
}

function schemaByNameOrId(
  registry: ArchitectureRegistryService,
  value: string,
): ArchitectureSchema | null {
  const direct = registry.findOne(value);
  if (direct) {
    return direct;
  }
  const normalizedValue = normalizeLegacyIdentifier(value);
  return registry.findAll().find((schema) => (
    normalizeLegacyIdentifier(schema.id) === normalizedValue
    || normalizeLegacyIdentifier(schema.name) === normalizedValue
  )) ?? null;
}

function normalizeLegacyIdentifier(value: string): string {
  return value.replace(/[_-]/g, '').toLowerCase();
}
