import { BadRequestException } from '@nestjs/common';
import type {
  ArchitectureExecutionMode,
  ArchitectureRoleSlot,
  ArchitectureSchema,
  ArchitectureSchemaEdge,
  ArchitectureSchemaNode,
  CreateArchitectureRunDto,
} from '@kalio/types';
import {
  cloneArchitectureContextPolicy,
  isArchitectureContextPolicy,
} from './architecture-context-policy';

export function validateArchitectureCreateRunDto(dto: CreateArchitectureRunDto): CreateArchitectureRunDto {
  if (!isNonEmptyString(dto?.schemaId)) {
    throw new BadRequestException('schemaId must be a non-empty string');
  }
  if (!isNonEmptyString(dto?.prompt)) {
    throw new BadRequestException('prompt must be a non-empty string');
  }
  if (dto?.context !== undefined && !isPlainRecord(dto.context)) {
    throw new BadRequestException('context must be an object when provided');
  }
  if (dto?.slotOverrides !== undefined && !isStringRecord(dto.slotOverrides)) {
    throw new BadRequestException('slotOverrides must map slot ids to persona ids');
  }
  if (dto?.executionMode !== undefined && !isExecutionMode(dto.executionMode)) {
    throw new BadRequestException('executionMode must be session_branches or subagent_execution');
  }
  if (dto?.schema !== undefined && !isArchitectureRuntimeSchema(dto.schema)) {
    throw new BadRequestException('schema must be a valid architecture schema when provided');
  }
  return dto;
}

export function validateArchitectureCreateRunSlotOverrides(
  schema: ArchitectureSchema,
  slotOverrides: Record<string, string> | undefined,
): void {
  if (!slotOverrides) {
    return;
  }

  const slotById = new Map(schema.roleSlots.map((slot) => [slot.id, slot]));
  for (const slotId of Object.keys(slotOverrides)) {
    const slot = slotById.get(slotId);
    if (!slot) {
      throw new BadRequestException(`Unknown role slot ${slotId}`);
    }
    if (!slot.canOverrideAtRunStart) {
      throw new BadRequestException(`Role slot ${slotId} cannot be overridden`);
    }
  }
}

export function cloneArchitectureRuntimeSchema(schema: ArchitectureSchema): ArchitectureSchema {
  return {
    ...schema,
    roleSlots: schema.roleSlots.map((slot) => ({ ...slot })),
    nodes: schema.nodes.map((node) => ({ ...node })),
    edges: schema.edges.map((edge) => ({ ...edge })),
    routerPolicy: { ...schema.routerPolicy },
    contextPolicy: cloneArchitectureContextPolicy(schema.contextPolicy),
    memoryPolicy: { ...schema.memoryPolicy },
  };
}

export function isArchitectureRuntimeSchema(value: unknown): value is ArchitectureSchema {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && typeof value.description === 'string'
    && isNonEmptyString(value.version)
    && Array.isArray(value.roleSlots)
    && value.roleSlots.every((slot) => isArchitectureRoleSlot(slot))
    && Array.isArray(value.nodes)
    && value.nodes.every((node) => isArchitectureSchemaNode(node))
    && Array.isArray(value.edges)
    && value.edges.every((edge) => isArchitectureSchemaEdge(edge))
    && hasValidNodeBehaviorTopology(value.nodes)
    && hasValidGraphTopology(value.nodes, value.edges)
    && isRouterPolicy(value.routerPolicy)
    && isArchitectureContextPolicy(value.contextPolicy)
    && isMemoryPolicy(value.memoryPolicy)
    && typeof value.outputArtifactSchema === 'string';
}

function isArchitectureRoleSlot(value: unknown): value is ArchitectureRoleSlot {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.label)
    && typeof value.description === 'string'
    && isSlotType(value.slotType)
    && isNonEmptyString(value.defaultPersonaId)
    && Array.isArray(value.allowedPersonaTags)
    && value.allowedPersonaTags.every((tag) => typeof tag === 'string')
    && typeof value.required === 'boolean'
    && typeof value.canOverrideAtRunStart === 'boolean';
}

function isArchitectureSchemaNode(value: unknown): value is ArchitectureSchemaNode {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.label)
    && isNodeKind(value.kind)
    && (value.roleSlotId === undefined || typeof value.roleSlotId === 'string')
    && (
      value.maxToolAttempts === undefined
      || (
        typeof value.maxToolAttempts === 'number'
        && Number.isInteger(value.maxToolAttempts)
        && value.maxToolAttempts >= 1
        && value.maxToolAttempts <= 100
      )
    )
    && (value.toolOverride === undefined || isNodeToolOverride(value.toolOverride))
    && (value.behavior === undefined || isNodeBehavior(value.behavior))
    && (value.x === undefined || typeof value.x === 'number')
    && (value.y === undefined || typeof value.y === 'number');
}

function isNodeToolOverride(value: unknown): value is NonNullable<ArchitectureSchemaNode['toolOverride']> {
  return isPlainRecord(value)
    && (
      value.allowedToolNames === undefined
      || (
        Array.isArray(value.allowedToolNames)
        && value.allowedToolNames.every((name) => typeof name === 'string' && name.trim().length > 0)
      )
    );
}

function isNodeBehavior(value: unknown): value is NonNullable<ArchitectureSchemaNode['behavior']> {
  return isPlainRecord(value)
    && isNodeBehaviorMode(value.mode)
    && (value.fanOut === undefined || value.fanOut === 'parallel' || value.fanOut === 'sequential')
    && (
      value.maxBranches === undefined
      || (typeof value.maxBranches === 'number' && Number.isInteger(value.maxBranches) && value.maxBranches > 0)
    )
    && (
      value.scoringPolicy === undefined
      || value.scoringPolicy === 'confidence'
      || value.scoringPolicy === 'risk'
      || value.scoringPolicy === 'cost'
      || value.scoringPolicy === 'custom'
    )
    && (value.description === undefined || typeof value.description === 'string');
}

function hasValidNodeBehaviorTopology(nodes: ArchitectureSchemaNode[]): boolean {
  return nodes.every((node) => {
    if (!node.behavior) {
      return node.kind !== 'role' || Boolean(node.roleSlotId);
    }
    if (node.kind === 'role' && !node.roleSlotId) {
      return false;
    }
    if (node.kind === 'role') {
      return false;
    }
    if (node.kind === 'artifact') {
      return node.behavior.mode === 'finalize' || node.behavior.mode === 'merge_inputs';
    }
    return node.behavior.mode !== 'finalize';
  });
}

function hasValidGraphTopology(nodes: ArchitectureSchemaNode[], edges: ArchitectureSchemaEdge[]): boolean {
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      return false;
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id) || edge.fromNodeId === edge.toNodeId) {
      return false;
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      return false;
    }
  }
  return true;
}

function isArchitectureSchemaEdge(value: unknown): value is ArchitectureSchemaEdge {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.fromNodeId)
    && isNonEmptyString(value.toNodeId)
    && (value.label === undefined || typeof value.label === 'string')
    && (
      value.selection === undefined
      || value.selection === 'default'
      || value.selection === 'converge'
      || value.selection === 'continuation'
    )
    && (value.returnToOrchestrator === undefined || typeof value.returnToOrchestrator === 'boolean');
}

function isRouterPolicy(value: unknown): value is ArchitectureSchema['routerPolicy'] {
  return isPlainRecord(value)
    && (value.mode === 'rank_then_merge' || value.mode === 'evidence_first' || value.mode === 'risk_weighted')
    && typeof value.mustAddressCriticFindings === 'boolean'
    && typeof value.canReturnNeedsMoreResearch === 'boolean';
}

function isMemoryPolicy(value: unknown): value is ArchitectureSchema['memoryPolicy'] {
  return isPlainRecord(value)
    && typeof value.persistFinalArtifact === 'boolean'
    && typeof value.persistRouterDecision === 'boolean';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainRecord(value)
    && Object.values(value).every((entry) => typeof entry === 'string' && entry.length > 0);
}

function isExecutionMode(value: unknown): value is ArchitectureExecutionMode {
  return value === 'session_branches' || value === 'subagent_execution';
}

function isSlotType(value: unknown): value is ArchitectureRoleSlot['slotType'] {
  return value === 'participant'
    || value === 'router'
    || value === 'judge'
    || value === 'finalizer'
    || value === 'critic'
    || value === 'tool_executor';
}

function isNodeKind(value: unknown): value is ArchitectureSchemaNode['kind'] {
  return value === 'parallel' || value === 'role' || value === 'router' || value === 'artifact';
}

function isNodeBehaviorMode(value: unknown): value is NonNullable<ArchitectureSchemaNode['behavior']>['mode'] {
  return value === 'fan_out_all'
    || value === 'choose_one'
    || value === 'rank_then_merge'
    || value === 'merge_inputs'
    || value === 'finalize';
}
