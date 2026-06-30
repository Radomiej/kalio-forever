import fs from 'node:fs/promises';
import path from 'node:path';
import { BadRequestException, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ArchitectureSchema, CreateArchitectureSchemaVariantDto } from '@kalio/types';
import {
  FIVE_MINDS_COUNCIL,
  FIVE_MINDS_STRATEGIC,
  GOAL_MASTER_DELIVERY_LOOP,
  STRATEGIC_DECISION_COUNCIL,
} from './architecture-seed-schemas';
import { DEEP_FIVE_MINDS } from './architecture-seed-schemas.deep';
import {
  ARCHITECTURE_DEBATE,
  CODING_REVIEW,
  DEEP_RESEARCH_FLOW,
  RELEASE_GUARD,
} from './architecture-seed-schemas.lab';
import { LAB_PRESET_SCHEMAS } from './architecture-seed-schemas.lab-presets';
import { cloneArchitectureContextPolicy, isArchitectureContextPolicy } from './architecture-context-policy';

const SCHEMA_ALIASES: Record<string, string> = {
  goal_guard_delivery_loop: 'goal-master-delivery-loop',
};

@Injectable()
export class ArchitectureRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ArchitectureRegistryService.name);
  private readonly registryDir: string;
  private readonly schemas = new Map<string, ArchitectureSchema>([
    [STRATEGIC_DECISION_COUNCIL.id, STRATEGIC_DECISION_COUNCIL],
    [FIVE_MINDS_COUNCIL.id, FIVE_MINDS_COUNCIL],
    [FIVE_MINDS_STRATEGIC.id, FIVE_MINDS_STRATEGIC],
    [GOAL_MASTER_DELIVERY_LOOP.id, GOAL_MASTER_DELIVERY_LOOP],
    [DEEP_FIVE_MINDS.id, DEEP_FIVE_MINDS],
    [ARCHITECTURE_DEBATE.id, ARCHITECTURE_DEBATE],
    [CODING_REVIEW.id, CODING_REVIEW],
    [DEEP_RESEARCH_FLOW.id, DEEP_RESEARCH_FLOW],
    [RELEASE_GUARD.id, RELEASE_GUARD],
    ...LAB_PRESET_SCHEMAS.map((schema) => [schema.id, schema] as const),
  ]);
  private readonly variantCounters = new Map<string, number>();
  private readonly variantWriteQueues = new Map<string, Promise<void>>();

  constructor(@Optional() private readonly config?: ConfigService) {
    this.registryDir = path.resolve(
      this.config?.get<string>('ARCHITECTURE_REGISTRY_PATH', './data/architecture-registry') ?? './data/architecture-registry',
      'schemas',
    );
  }

  async onModuleInit(): Promise<void> {
    await this.loadPersistedSchemas();
  }

  findAll(): ArchitectureSchema[] {
    return Array.from(this.schemas.values()).map((schema) => this.cloneSchema(schema));
  }

  findOne(id: string): ArchitectureSchema | null {
    const schema = this.schemas.get(SCHEMA_ALIASES[id] ?? id);
    return schema ? this.cloneSchema(schema) : null;
  }

  async createVariant(baseSchemaId: string, dto: CreateArchitectureSchemaVariantDto): Promise<ArchitectureSchema | null> {
    return this.runExclusive(baseSchemaId, async () => {
      const baseSchema = this.findOne(baseSchemaId);
      if (!baseSchema) {
        return null;
      }
      this.validateVariantDto(baseSchema, dto);

      const variantNumber = this.nextVariantNumber(baseSchemaId);
      const roleSlotPersonaOverrides = dto.roleSlotPersonaOverrides ?? {};
      const nodeKindOverrides = dto.nodeKindOverrides ?? {};
      const nodes = (dto.nodes ?? baseSchema.nodes).map((node) => ({
        ...node,
        toolOverride: node.toolOverride ? { ...node.toolOverride } : undefined,
        kind: nodeKindOverrides[node.id] ?? node.kind,
      }));
      const variant: ArchitectureSchema = {
        ...baseSchema,
        id: `${baseSchema.id}-variant-${variantNumber}`,
        name: this.readNonEmpty(dto.name) ?? `${baseSchema.name} Variant ${variantNumber}`,
        description: this.readNonEmpty(dto.description) ?? baseSchema.description,
        version: `${baseSchema.version}+variant.${variantNumber}`,
        roleSlots: baseSchema.roleSlots.map((slot) => ({
          ...slot,
          defaultPersonaId: roleSlotPersonaOverrides[slot.id] ?? slot.defaultPersonaId,
        })),
        nodes,
        edges: (dto.edges ?? baseSchema.edges).map((edge) => ({ ...edge })),
        routerPolicy: { ...baseSchema.routerPolicy },
        contextPolicy: dto.contextPolicy ? cloneArchitectureContextPolicy(dto.contextPolicy) : cloneArchitectureContextPolicy(baseSchema.contextPolicy),
        memoryPolicy: { ...baseSchema.memoryPolicy },
      };
      await this.writeSchema(variant);
      return variant;
    });
  }

  async removeVariant(schemaId: string): Promise<boolean> {
    const schema = this.schemas.get(schemaId);
    if (!schema) {
      return false;
    }
    if (!this.isVariantSchemaId(schemaId)) {
      throw new BadRequestException('Only persisted architecture variants can be deleted');
    }

    const filePath = path.join(this.registryDir, `${this.toSchemaFileName(schemaId)}.json`);
    try {
      await fs.rm(filePath, { force: true });
    } catch (error) {
      this.logger.warn(`Failed to delete architecture schema file ${filePath}`, error);
      throw error;
    }
    this.schemas.delete(schemaId);
    return true;
  }

  private async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.variantWriteQueues.get(key) ?? Promise.resolve();
    const ready = previous.catch((err) => {
      this.logger.warn(`Previous architecture variant write failed for ${key}; continuing queue`, err);
      return undefined;
    });
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = ready.then(() => current);
    this.variantWriteQueues.set(key, queued);

    await ready;
    try {
      return await task();
    } finally {
      release();
      if (this.variantWriteQueues.get(key) === queued) {
        this.variantWriteQueues.delete(key);
      }
    }
  }

  private nextVariantNumber(baseSchemaId: string): number {
    let next = (this.variantCounters.get(baseSchemaId) ?? 0) + 1;
    while (this.schemas.has(`${baseSchemaId}-variant-${next}`)) {
      next += 1;
    }
    return next;
  }

  private isVariantSchemaId(schemaId: string): boolean {
    return /-variant-\d+$/.test(schemaId);
  }

  private async loadPersistedSchemas(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.registryDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Failed to read architecture registry directory ${this.registryDir}`, error);
      }
      return;
    }

    for (const entry of entries.filter((fileName) => fileName.endsWith('.json')).sort()) {
      const filePath = path.join(this.registryDir, entry);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const schema = this.parsePersistedSchema(JSON.parse(raw), filePath);
        this.schemas.set(schema.id, this.cloneSchema(schema));
        this.refreshVariantCounter(schema.id);
      } catch (error) {
        this.logger.warn(`Failed to load persisted architecture schema ${filePath}`, error);
      }
    }
  }

  private async writeSchema(schema: ArchitectureSchema): Promise<void> {
    await fs.mkdir(this.registryDir, { recursive: true });
    const filePath = path.join(this.registryDir, `${this.toSchemaFileName(schema.id)}.json`);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
    this.schemas.set(schema.id, this.cloneSchema(schema));
    this.refreshVariantCounter(schema.id);
  }

  private toSchemaFileName(schemaId: string): string {
    if (!/^[a-zA-Z0-9._@+-]+$/.test(schemaId)) {
      throw new BadRequestException(`Invalid schema id ${schemaId}`);
    }
    return schemaId;
  }

  private parsePersistedSchema(value: unknown, filePath: string): ArchitectureSchema {
    if (!this.isArchitectureSchema(value)) {
      throw new Error(`Architecture schema file is malformed: ${filePath}`);
    }
    return value;
  }

  private isArchitectureSchema(value: unknown): value is ArchitectureSchema {
    if (!this.isPlainRecord(value)) {
      return false;
    }
    return typeof value.id === 'string'
      && typeof value.name === 'string'
      && typeof value.description === 'string'
      && typeof value.version === 'string'
      && Array.isArray(value.roleSlots)
      && Array.isArray(value.nodes)
      && Array.isArray(value.edges)
      && typeof value.outputArtifactSchema === 'string';
  }

  private refreshVariantCounter(schemaId: string): void {
    for (const baseSchema of this.schemas.values()) {
      if (baseSchema.id === schemaId) {
        continue;
      }
      const match = new RegExp(`^${this.escapeRegex(baseSchema.id)}-variant-(\\d+)$`).exec(schemaId);
      if (!match) {
        continue;
      }
      const next = Number.parseInt(match[1], 10);
      const current = this.variantCounters.get(baseSchema.id) ?? 0;
      if (Number.isFinite(next) && next > current) {
        this.variantCounters.set(baseSchema.id, next);
      }
    }
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private cloneSchema(schema: ArchitectureSchema): ArchitectureSchema {
    return {
      ...schema,
      roleSlots: schema.roleSlots.map((slot) => ({ ...slot })),
      nodes: schema.nodes.map((node) => ({
        ...node,
        toolOverride: node.toolOverride ? { ...node.toolOverride } : undefined,
      })),
      edges: schema.edges.map((edge) => ({ ...edge })),
      routerPolicy: { ...schema.routerPolicy },
      contextPolicy: cloneArchitectureContextPolicy(schema.contextPolicy),
      memoryPolicy: { ...schema.memoryPolicy },
    };
  }

  private readNonEmpty(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private validateVariantDto(baseSchema: ArchitectureSchema, dto: CreateArchitectureSchemaVariantDto): void {
    if (!this.isPlainRecord(dto)) {
      throw new BadRequestException('variant body must be an object');
    }
    if (dto.name !== undefined && typeof dto.name !== 'string') {
      throw new BadRequestException('name must be a string when provided');
    }
    if (dto.description !== undefined && typeof dto.description !== 'string') {
      throw new BadRequestException('description must be a string when provided');
    }
    if (dto.roleSlotPersonaOverrides !== undefined && !this.isStringRecord(dto.roleSlotPersonaOverrides)) {
      throw new BadRequestException('roleSlotPersonaOverrides must map slot ids to persona ids');
    }
    if (dto.nodeKindOverrides !== undefined && !this.isNodeKindRecord(dto.nodeKindOverrides)) {
      throw new BadRequestException('nodeKindOverrides must map node ids to valid node kinds');
    }
    if (dto.nodes !== undefined && !Array.isArray(dto.nodes)) {
      throw new BadRequestException('nodes must be an array when provided');
    }
    if (dto.edges !== undefined && !Array.isArray(dto.edges)) {
      throw new BadRequestException('edges must be an array when provided');
    }
    if (dto.contextPolicy !== undefined && !isArchitectureContextPolicy(dto.contextPolicy)) {
      throw new BadRequestException('contextPolicy must be a valid architecture context policy when provided');
    }

    const slotById = new Map(baseSchema.roleSlots.map((slot) => [slot.id, slot]));
    for (const slotId of Object.keys(dto.roleSlotPersonaOverrides ?? {})) {
      const slot = slotById.get(slotId);
      if (!slot) {
        throw new BadRequestException(`Unknown role slot ${slotId}`);
      }
      if (!slot.canOverrideAtRunStart) {
        throw new BadRequestException(`Role slot ${slotId} cannot be overridden`);
      }
    }

    const nodeIds = new Set(baseSchema.nodes.map((node) => node.id));
    for (const nodeId of Object.keys(dto.nodeKindOverrides ?? {})) {
      if (!nodeIds.has(nodeId)) {
        throw new BadRequestException(`Unknown architecture node ${nodeId}`);
      }
    }
    if (dto.nodes) {
      this.validateNodes(dto.nodes, slotById);
    }
    this.validateEdges(dto.edges ?? baseSchema.edges, new Set((dto.nodes ?? baseSchema.nodes).map((node) => node.id)));
  }

  private validateNodes(nodes: ArchitectureSchema['nodes'], slotById: Map<string, ArchitectureSchema['roleSlots'][number]>): void {
    const seen = new Set<string>();
    for (const node of nodes) {
      if (!this.isPlainRecord(node) || !this.readNonEmpty(node.id) || !this.readNonEmpty(node.label)) {
        throw new BadRequestException('nodes must include non-empty id and label');
      }
      if (seen.has(node.id)) {
        throw new BadRequestException(`Duplicate architecture node ${node.id}`);
      }
      seen.add(node.id);
      if (!this.isNodeKind(node.kind)) {
        throw new BadRequestException(`Invalid architecture node kind ${String(node.kind)}`);
      }
      if (node.roleSlotId !== undefined && !slotById.has(node.roleSlotId)) {
        throw new BadRequestException(`Unknown role slot ${node.roleSlotId}`);
      }
      if ((node.kind === 'role' || node.kind === 'router' || node.kind === 'artifact') && !this.readNonEmpty(node.roleSlotId)) {
        throw new BadRequestException(`Architecture node ${node.id} requires a roleSlotId`);
      }
      if ((node.x !== undefined && !Number.isFinite(node.x)) || (node.y !== undefined && !Number.isFinite(node.y))) {
        throw new BadRequestException(`Invalid coordinates for architecture node ${node.id}`);
      }
      if (node.toolOverride !== undefined && !this.isNodeToolOverride(node.toolOverride)) {
        throw new BadRequestException(`Invalid tool override for architecture node ${node.id}`);
      }
    }
  }

  private isNodeToolOverride(value: unknown): boolean {
    return this.isPlainRecord(value)
      && (
        (value as { allowedToolNames?: unknown }).allowedToolNames === undefined
        || (
          Array.isArray((value as { allowedToolNames?: unknown }).allowedToolNames)
          && (value as { allowedToolNames: unknown[] }).allowedToolNames.every((name) => (
            typeof name === 'string' && name.trim().length > 0
          ))
        )
      );
  }

  private validateEdges(edges: ArchitectureSchema['edges'], nodeIds: Set<string>): void {
    const seen = new Set<string>();
    for (const edge of edges) {
      if (!this.isPlainRecord(edge) || !this.readNonEmpty(edge.id)) {
        throw new BadRequestException('edges must include a non-empty id');
      }
      if (seen.has(edge.id)) {
        throw new BadRequestException(`Duplicate architecture edge ${edge.id}`);
      }
      seen.add(edge.id);
      if (edge.fromNodeId === edge.toNodeId) {
        throw new BadRequestException(`Architecture edge ${edge.id} cannot target the same node`);
      }
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
        throw new BadRequestException(`Architecture edge ${edge.id} references an unknown node`);
      }
    }
  }

  private isStringRecord(value: unknown): value is Record<string, string> {
    return this.isPlainRecord(value)
      && Object.values(value).every((entry) => typeof entry === 'string' && entry.length > 0);
  }

  private isNodeKindRecord(value: unknown): value is Record<string, ArchitectureSchema['nodes'][number]['kind']> {
    return this.isPlainRecord(value)
      && Object.values(value).every((entry) => this.isNodeKind(entry));
  }

  private isNodeKind(value: unknown): value is ArchitectureSchema['nodes'][number]['kind'] {
    return value === 'parallel'
      || value === 'role'
      || value === 'router'
      || value === 'artifact';
  }

  private isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

