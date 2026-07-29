import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type {
  ArchitectureExecutionMode,
  ArchitectureRoleSlot,
  ArchitectureRun,
  ArchitectureSchema,
  CreateArchitectureRunDto,
} from '@kalio/types';
import { SessionsService } from '../chat/sessions.service';
import { CLIAgentConfigService } from '../cli-agent/cli-agent-config.service';
import { extractAllowanceContext } from '../agent-flow/agent-flow-launch-context';
import { VFSService } from '../vfs/vfs.service';
import { ArchitectureRegistryService } from './architecture-registry.service';
import {
  ARCHITECTURE_CLI_AGENT_IDS,
  buildArchitectureCliAgentContext,
  buildArchitectureVfsEvidenceContext,
  type ArchitectureCliAgentConfigSnapshot,
} from './architecture-runtime-context.utils';
import {
  validateArchitectureCreateRunDto,
  validateArchitectureCreateRunSlotOverrides,
} from './architecture-runtime-schema.utils';
import { hydrateArchitectureRootVfs, type ArchitectureVfsHydrationResult } from './architecture-vfs-hydration';
import {
  createArchitectureBranchSessionRuntimeContext,
  createArchitectureRootSessionRuntimeContext,
  getArchitectureParentSessionId,
  getArchitectureParentToolCallId,
  getPersistedArchitectureHistorySessionId,
  getPersistedArchitectureHostSessionId,
  getPersistedArchitectureParentSessionId,
} from './architecture-session-context';

export interface PreparedArchitectureRun {
  schema: ArchitectureSchema;
  run: ArchitectureRun;
  hydration: ArchitectureVfsHydrationResult | null;
}

@Injectable()
export class ArchitectureRunPreparationService {
  private readonly logger = new Logger(ArchitectureRunPreparationService.name);

  constructor(
    private readonly registry: ArchitectureRegistryService,
    private readonly sessions: SessionsService,
    @Optional() private readonly vfs?: VFSService,
    @Optional() private readonly cliAgentConfig?: Pick<CLIAgentConfigService, 'getConfig'>,
  ) {}

  async prepareRun(dto: CreateArchitectureRunDto, status: ArchitectureRun['status']): Promise<PreparedArchitectureRun> {
    const normalizedDto = await this.normalizeCreateRunDto(dto);
    const baseSchema = this.registry.findOne(normalizedDto.schemaId);
    if (!baseSchema) throw new NotFoundException(`Architecture schema ${normalizedDto.schemaId} not found`);
    const schema = normalizedDto.schema ?? baseSchema;
    validateArchitectureCreateRunSlotOverrides(schema, normalizedDto.slotOverrides);

    const now = Date.now();
    const runId = nanoid();
    const rootSessionId = `arch-${runId}-root`;
    const branchSessionIds = await this.createBranchSessions(schema, runId, rootSessionId, normalizedDto);
    const hydration = hydrateArchitectureRootVfs(this.vfs, rootSessionId, normalizedDto.context);
    const contextWithEvidence = await this.addCliAgentPreferencesToContext(
      this.addVfsEvidenceToContext(normalizedDto.context, rootSessionId, hydration),
    );
    const run: ArchitectureRun = {
      id: runId,
      schemaId: normalizedDto.schemaId,
      prompt: normalizedDto.prompt,
      executionMode: normalizedDto.executionMode ?? 'session_branches',
      context: contextWithEvidence,
      slotOverrides: normalizedDto.slotOverrides,
      rootSessionId,
      branchSessionIds,
      status,
      createdAt: now,
      updatedAt: now,
    };
    return { schema, run, hydration };
  }

  private async normalizeCreateRunDto(dto: CreateArchitectureRunDto): Promise<CreateArchitectureRunDto> {
    const validated = validateArchitectureCreateRunDto(dto);
    const inheritedContext = await this.inheritAllowanceContext(validated.context);
    return {
      ...validated,
      ...(inheritedContext ? { context: inheritedContext } : {}),
    };
  }

  private async addCliAgentPreferencesToContext(
    context: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.cliAgentConfig || context?.['cliAgentToolPreferences'] !== undefined || context?.['availableCliAgents'] !== undefined) {
      return context;
    }
    const configs: ArchitectureCliAgentConfigSnapshot[] = [];
    for (const agentId of ARCHITECTURE_CLI_AGENT_IDS) {
      const config = await this.cliAgentConfig.getConfig(agentId);
      configs.push({
        agentId,
        enabled: config.enabled,
        model: config.model,
        architecturePreference: config.architecturePreference,
      });
    }
    return buildArchitectureCliAgentContext(context, configs);
  }

  private async inheritAllowanceContext(
    context: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown> | undefined> {
    if (!context) {
      return context;
    }
    const parentSessionId = getArchitectureParentSessionId(context);
    if (!parentSessionId) {
      return context;
    }

    const inherited = await this.resolveParentAllowanceBaseline(parentSessionId);
    if (Object.keys(inherited).length === 0) {
      return context;
    }
    return {
      ...inherited,
      ...context,
    };
  }

  private async resolveParentAllowanceBaseline(parentSessionId: string): Promise<Record<string, unknown>> {
    const baseline: Record<string, unknown> = {};
    const visited = new Set<string>();
    let currentSessionId: string | undefined = parentSessionId;

    while (currentSessionId && !visited.has(currentSessionId)) {
      visited.add(currentSessionId);
      try {
        const session = await this.sessions.get(currentSessionId);
        const allowanceContext = extractAllowanceContext(session.runtimeContext?.architectureContext);
        for (const [key, value] of Object.entries(allowanceContext)) {
          if (!(key in baseline)) {
            baseline[key] = value;
          }
        }
        currentSessionId = session.parentSessionId;
      } catch (error: unknown) {
        this.logger.debug(
          `Unable to resolve allowance baseline for ${currentSessionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
    }

    return baseline;
  }

  private addVfsEvidenceToContext(
    context: Record<string, unknown> | undefined,
    rootSessionId: string,
    hydration: ArchitectureVfsHydrationResult | null,
  ): Record<string, unknown> | undefined {
    if (!hydration || !this.vfs || hydration.copiedFiles.length === 0) {
      return context;
    }

    return buildArchitectureVfsEvidenceContext(context, {
      rootSessionId,
      hydration,
      readFile: (path) => this.vfs?.readBinary(rootSessionId, path) ?? Buffer.alloc(0),
    });
  }

  private async createBranchSessions(
    schema: ArchitectureSchema,
    runId: string,
    rootSessionId: string,
    dto: CreateArchitectureRunDto,
  ): Promise<Record<string, string>> {
    const isAgentFlowRoot = this.isAgentFlowContext(dto.context);
    const hostSessionId = getPersistedArchitectureHostSessionId(dto.context);
    const historySessionId = getPersistedArchitectureHistorySessionId(dto.context);
    await this.sessions.createWithId(rootSessionId, {
      personaId: 'default',
      title: this.toRunSessionTitle(dto.prompt),
      kind: isAgentFlowRoot ? 'agent-flow' : 'chat',
      parentSessionId: getPersistedArchitectureParentSessionId(dto.context),
      parentToolCallId: getArchitectureParentToolCallId(dto.context),
      runtimeContext: createArchitectureRootSessionRuntimeContext({
        runId,
        schemaId: schema.id,
        schemaName: schema.name,
        hostSessionId,
        historySessionId,
      }),
    }, { registerRuntimeProjectPath: true });

    const executableSlots = schema.roleSlots.filter((slot) => this.shouldCreateBranch(slot, schema, dto.executionMode));
    const pairs = await Promise.all(
      executableSlots.map(async (slot) => {
        const sessionId = `arch-${runId}-${slot.id}`;
        const personaId = this.resolveArchitecturePersonaId(dto.slotOverrides?.[slot.id] ?? slot.defaultPersonaId);
        await this.sessions.createWithId(sessionId, {
          personaId,
          title: `${schema.name}: ${slot.label}`,
          kind: 'subagent',
          parentSessionId: rootSessionId,
          runtimeContext: createArchitectureBranchSessionRuntimeContext({
            runId,
            schemaId: schema.id,
            schemaName: schema.name,
            rootSessionId,
            slot,
            hostSessionId,
            historySessionId,
          }),
        }, { registerRuntimeProjectPath: true });
        return [slot.id, sessionId] as const;
      }),
    );

    return Object.fromEntries(pairs);
  }

  private shouldCreateBranch(
    slot: ArchitectureRoleSlot,
    schema: ArchitectureSchema,
    executionMode: ArchitectureExecutionMode | undefined,
  ): boolean {
    if (executionMode === 'subagent_execution') {
      return schema.nodes.some((node) => node.roleSlotId === slot.id);
    }
    return slot.slotType === 'participant'
      || slot.slotType === 'critic'
      || slot.slotType === 'tool_executor';
  }

  resolveArchitecturePersonaId(personaId: string): string {
    return ARCHITECTURE_PERSONA_ALIASES[personaId] ?? personaId;
  }

  private isAgentFlowContext(context: Record<string, unknown> | undefined): boolean {
    return this.isPlainRecord(context?.['subAgentFlow']);
  }

  private isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private toRunSessionTitle(prompt: string): string {
    const trimmed = prompt.trim();
    const summary = trimmed.length > 56 ? `${trimmed.slice(0, 56)}...` : trimmed;
    return `Architecture: ${summary || 'Untitled run'}`;
  }
}

const ARCHITECTURE_PERSONA_ALIASES: Record<string, string> = {
  'persona.pragmatist': 'dev',
  'persona.delivery_pragmatist': 'dev',
  'persona.innovator': 'jony',
  'persona.product_innovator': 'jony',
  'persona.analyst': 'web-research',
  'persona.cost_analyst': 'web-research',
  'persona.data_analyst': 'web-research',
  'persona.user_advocate': 'designer',
  'persona.power_user_advocate': 'designer',
  'persona.shadow': 'orchestrator',
  'persona.general_shadow': 'orchestrator',
  'persona.security_shadow': 'orchestrator',
  'persona.decision_router': 'orchestrator',
  'persona.conservative_architecture_router': 'orchestrator',
  'persona.security_router': 'orchestrator',
  'persona.adr_writer': 'dev',
};
