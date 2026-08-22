import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type {
  CreateExecutionProfileDto,
  ExecutionApprovalMode,
  ExecutionProfile,
  ExecutionProfileKind,
  UpdateExecutionProfileDto,
} from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { executionProfiles } from '../../database/schema';

const DEFAULT_APPROVAL_MODE: ExecutionApprovalMode = 'codex_guard';
const CAPABILITIES_VERSION = '1';

@Injectable()
export class ExecutionProfileService {
  constructor(private readonly drizzle: DrizzleService) {}

  async list(): Promise<ExecutionProfile[]> {
    const rows = await this.drizzle.db.select().from(executionProfiles);
    return rows.map((row) => this.toProfile(row));
  }

  async get(id: string): Promise<ExecutionProfile> {
    const [row] = await this.drizzle.db
      .select()
      .from(executionProfiles)
      .where(eq(executionProfiles.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`Execution profile not found: ${id}`);
    }
    return this.toProfile(row);
  }

  async assertEnabled(id: string): Promise<ExecutionProfile> {
    const profile = await this.get(id);
    if (!profile.enabled) {
      throw new ConflictException(`Execution profile is disabled: ${id}`);
    }
    return profile;
  }

  async create(dto: CreateExecutionProfileDto): Promise<ExecutionProfile> {
    const normalized = normalizeCreateProfile(dto);
    const now = new Date();
    const id = nanoid();
    await this.drizzle.db.insert(executionProfiles).values({
      id,
      ...normalized,
      capabilitiesVersion: CAPABILITIES_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateExecutionProfileDto): Promise<ExecutionProfile> {
    await this.get(id);
    const set: {
      name?: string;
      model?: string;
      authProfileId?: string | null;
      reasoningEffort?: string | null;
      approvalMode?: ExecutionApprovalMode;
      enabled?: boolean;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new ConflictException('Execution profile name is required.');
      set.name = name;
    }
    if (dto.model !== undefined) set.model = dto.model.trim();
    if (dto.authProfileId !== undefined) set.authProfileId = normalizeOptional(dto.authProfileId);
    if (dto.reasoningEffort !== undefined) set.reasoningEffort = normalizeOptional(dto.reasoningEffort);
    if (dto.approvalMode !== undefined) set.approvalMode = dto.approvalMode;
    if (dto.enabled !== undefined) set.enabled = dto.enabled;
    await this.drizzle.db.update(executionProfiles).set(set).where(eq(executionProfiles.id, id));
    return this.get(id);
  }

  private toProfile(row: typeof executionProfiles.$inferSelect): ExecutionProfile {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as ExecutionProfileKind,
      ...(row.provider ? { provider: row.provider } : {}),
      model: row.model,
      ...(row.authProfileId ? { authProfileId: row.authProfileId } : {}),
      ...(row.reasoningEffort ? { reasoningEffort: row.reasoningEffort } : {}),
      approvalMode: row.approvalMode as ExecutionApprovalMode,
      enabled: row.enabled,
      capabilitiesVersion: row.capabilitiesVersion,
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }
}

function normalizeCreateProfile(dto: CreateExecutionProfileDto): {
  name: string;
  kind: ExecutionProfileKind;
  provider: CreateExecutionProfileDto['provider'] | null;
  model: string;
  authProfileId: string | null;
  reasoningEffort: string | null;
  approvalMode: ExecutionApprovalMode;
  enabled: boolean;
} {
  const name = dto.name.trim();
  if (!name) throw new ConflictException('Execution profile name is required.');
  const model = dto.model.trim();
  if (!model && dto.kind === 'codex-app-server') {
    throw new ConflictException('Codex App Server profiles require a model.');
  }
  if (dto.kind === 'direct-llm' && !dto.provider) {
    throw new ConflictException('Direct LLM profiles require a provider.');
  }
  return {
    name,
    kind: dto.kind,
    provider: dto.provider ?? null,
    model,
    authProfileId: normalizeOptional(dto.authProfileId),
    reasoningEffort: normalizeOptional(dto.reasoningEffort),
    approvalMode: dto.approvalMode ?? DEFAULT_APPROVAL_MODE,
    enabled: dto.enabled ?? true,
  };
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function toMs(value: number | Date): number {
  return value instanceof Date ? value.getTime() : value;
}
