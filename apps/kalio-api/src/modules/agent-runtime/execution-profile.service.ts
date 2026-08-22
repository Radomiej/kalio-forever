import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import type {
  CreateExecutionProfileDto,
  ExecutionApprovalMode,
  ExecutionProfile,
  ExecutionProfileKind,
  LLMProviderType,
  ResolveDirectExecutionProfileDto,
  UpdateExecutionProfileDto,
} from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { executionProfiles } from '../../database/schema';
import { CredentialsService } from '../credentials/credentials.service';

const DEFAULT_APPROVAL_MODE: ExecutionApprovalMode = 'codex_guard';
const CAPABILITIES_VERSION = '1';

@Injectable()
export class ExecutionProfileService {
  constructor(
    private readonly drizzle: DrizzleService,
    @Optional() private readonly credentials?: CredentialsService,
  ) {}

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

  async resolveDirect(dto: ResolveDirectExecutionProfileDto): Promise<ExecutionProfile> {
    if (!this.credentials) {
      throw new ConflictException('Direct execution profile resolver is not configured.');
    }
    const credentialId = dto.credentialId.trim();
    const model = dto.model.trim();
    if (!credentialId || !model) {
      throw new ConflictException('A credential and model are required for a direct execution profile.');
    }

    const providerConfig = await this.credentials.getProviderConfigForCredential(credentialId);
    if (!providerConfig) {
      throw new NotFoundException(`Credential not found or unavailable: ${credentialId}`);
    }

    const discoveredModels = await this.credentials.getModelsForCredential(credentialId);
    const configuredModel = providerConfig.model.trim();
    if (discoveredModels.length > 0 && model !== configuredModel && !discoveredModels.includes(model)) {
      throw new ConflictException(`Model is not available for credential ${credentialId}: ${model}`);
    }

    const id = directProfileId(credentialId, providerConfig.provider, model);
    const existing = await this.drizzle.db
      .select()
      .from(executionProfiles)
      .where(eq(executionProfiles.id, id))
      .then((rows) => rows[0]);
    if (existing) {
      if (!existing.enabled) throw new ConflictException(`Execution profile is disabled: ${id}`);
      if (
        existing.kind !== 'direct-llm'
        || existing.provider !== providerConfig.provider
        || existing.authProfileId !== credentialId
        || existing.model !== model
      ) {
        throw new ConflictException(`Direct execution profile identity conflict: ${id}`);
      }
      return this.toProfile(existing);
    }

    const now = new Date();
    await this.drizzle.db.insert(executionProfiles).values({
      id,
      name: `Direct LLM - ${providerConfig.provider} - ${model}`,
      kind: 'direct-llm',
      provider: providerConfig.provider as LLMProviderType,
      model,
      authProfileId: credentialId,
      reasoningEffort: null,
      approvalMode: DEFAULT_APPROVAL_MODE,
      enabled: true,
      capabilitiesVersion: CAPABILITIES_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateExecutionProfileDto): Promise<ExecutionProfile> {
    const existing = await this.get(id);
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
    if (dto.model !== undefined) {
      const model = dto.model.trim();
      if (existing.kind === 'devin-cli-acp' && !isDevinCliModel(model)) {
        throw new ConflictException(`Devin CLI ACP supports only: ${DEVIN_CLI_MODELS.join(', ')}.`);
      }
      set.model = model;
    }
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
  if (!model && dto.kind !== 'direct-llm') {
    throw new ConflictException(`${dto.kind} profiles require a model.`);
  }
  if (dto.kind === 'direct-llm' && !dto.provider) {
    throw new ConflictException('Direct LLM profiles require a provider.');
  }
  if (dto.kind === 'devin-cli-acp' && !isDevinCliModel(model)) {
    throw new ConflictException(`Devin CLI ACP supports only: ${DEVIN_CLI_MODELS.join(', ')}.`);
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

function directProfileId(credentialId: string, provider: string, model: string): string {
  const identity = `${credentialId}\u0000${provider}\u0000${model}`;
  return `direct-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

const DEVIN_CLI_MODELS = ['glm-5-2', 'swe-1-7'] as const;

function isDevinCliModel(value: string): value is (typeof DEVIN_CLI_MODELS)[number] {
  return (DEVIN_CLI_MODELS as readonly string[]).includes(value);
}
