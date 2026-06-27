import { Injectable } from '@nestjs/common';
import type {
  ArchitectureSlotToolPolicy,
  MCPPolicy,
  PersonaSessionConfig,
  SessionRuntimeContext,
  SessionRuntimeKind,
  ToolDenyReason,
  ToolMeta,
  ToolPolicyDecision,
  ToolPolicySource,
} from '@kalio/types';
import { PersonaService } from '../persona/persona.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { applyArchitectureCliToolPreferences } from './architecture-slot-tool-policy';
import { resolveToolAlias } from './mcp-tool-allow-list';

const HOST_FS_TOOL_NAMES = new Set(['fs_list', 'fs_read', 'fs_write', 'fs_grep', 'fs_delete']);
const TERMINAL_TOOL_NAMES = new Set(['terminal_spawn', 'terminal_output', 'terminal_list']);
const CLI_AGENT_TOOL_NAMES = new Set([
  'spawn_cli_agent',
  'message_cli_agent',
  'get_cli_agent_status',
  'wait_for',
  'run_cli_agent',
  'stop_cli_agent',
]);
const SUBAGENT_TOOL_NAMES = new Set(['run_subagent', 'spawn_subagent', 'message_subagent']);

export interface ToolPolicyRequest {
  runtimeKind: SessionRuntimeKind;
  personaId: string;
  sessionRuntimeContext?: SessionRuntimeContext;
  architectureContext?: Record<string, unknown>;
  explicitToolNames?: string[];
  explicitTools?: ToolMeta[];
  slotPolicy?: ArchitectureSlotToolPolicy;
  subagentDepth?: number;
  autoApproveTools?: string[];
}

@Injectable()
export class ToolPolicyService {
  constructor(
    private readonly personaService: PersonaService,
    private readonly toolDispatch: ToolDispatchService,
  ) {}

  async decide(request: ToolPolicyRequest): Promise<ToolPolicyDecision> {
    const allTools = this.toolDispatch.getToolMetas() ?? [];
    const toolByName = new Map(allTools.map((tool) => [tool.name, tool]));
    for (const tool of request.explicitTools ?? []) {
      toolByName.set(tool.name, tool);
    }
    const personaConfig = await this.personaService.getSessionConfig(request.personaId);
    const warnings: string[] = [];
    const denied: ToolPolicyDecision['denied'] = [];

    if (request.runtimeKind === 'agent-flow-root' || request.runtimeKind === 'cli-agent') {
      warnings.push(
        `Tool policy profile "${request.runtimeKind}" is not fully specialized; using persona allowlist with runtime constraints.`,
      );
    }

    const personaNames = this.resolvePersonaToolNames([...toolByName.values()], personaConfig);
    const explicitNames = request.explicitToolNames ?? request.sessionRuntimeContext?.explicitToolNames;
    const slotNames = request.slotPolicy?.allowedToolNames;
    const architectureContext = request.architectureContext
      ?? request.sessionRuntimeContext?.architectureContext;
    const launchNames = launchAllowedToolNames(architectureContext);

    let candidateNames: Set<string>;
    let source: ToolPolicySource;

    switch (request.runtimeKind) {
      case 'agent-flow-branch': {
        // Architecture branches inherit the launch-visible toolset from the parent turn.
        // Branch personas describe role prompting, while orchestrator slot policy performs
        // the actual narrowing for project/folder-scoped runs.
        const slotSet = new Set(slotNames ?? []);
        const launchSet = launchNames !== undefined
          ? new Set(launchNames.filter((name) => toolByName.has(name)))
          : null;
        candidateNames = request.slotPolicy
          ? launchSet
            ? intersectSets(launchSet, slotSet)
            : new Set([...slotSet].filter((name) => toolByName.has(name)))
          : new Set(launchSet ?? personaNames);
        source = 'merged';
        if (launchSet) {
          for (const name of slotSet) {
            if (!launchSet.has(name) && toolByName.has(name)) {
              denied.push({ name, reason: 'not_in_runtime_explicit_list' });
            }
          }
        }
        for (const name of launchSet ?? candidateNames) {
          if (slotNames && slotNames.length > 0 && !slotSet.has(name) && toolByName.has(name)) {
            denied.push({ name, reason: 'slot_policy_denied' });
          }
        }
        break;
      }
      case 'subagent': {
        if (explicitNames && explicitNames.length > 0) {
          const allowsAllNative = (personaConfig?.allowedTools ?? []).length === 0;
          const resolvedExplicit = explicitNames
            .map((name) => resolveToolAlias(name, new Set(toolByName.keys())));
          candidateNames = new Set(
            resolvedExplicit
              .filter((name): name is string => name !== null)
              .filter((name) => (allowsAllNative || personaNames.has(name) || name.startsWith('mcp_'))),
          );
          source = 'runtime-explicit';
          for (const name of resolvedExplicit) {
            if (!name || !toolByName.has(name)) {
              continue;
            }
            if (!candidateNames.has(name)) {
              denied.push({
                name,
                reason: personaNames.has(name) ? 'not_in_runtime_explicit_list' : 'not_in_persona_allowlist',
              });
            }
          }
        } else {
          candidateNames = new Set(personaNames);
          source = 'persona';
        }
        break;
      }
      default:
        candidateNames = new Set(personaNames);
        source = 'persona';
        break;
    }

    const autoApprove = new Set(request.autoApproveTools ?? []);
    const allowedTools: ToolMeta[] = [];
    const allowedNames: string[] = [];

    for (const name of candidateNames) {
      const tool = toolByName.get(name);
      if (!tool) {
        continue;
      }
      const denyReason = this.runtimeDenyReason(tool, {
        runtimeKind: request.runtimeKind,
        architectureContext,
        subagentDepth: request.subagentDepth ?? 0,
        stripRequiresConfirmation: request.slotPolicy?.stripRequiresConfirmation === true,
        autoApprove,
      });
      if (denyReason) {
        if (!denied.some((entry) => entry.name === name && entry.reason === denyReason)) {
          denied.push({ name, reason: denyReason });
        }
        continue;
      }
      allowedTools.push(tool);
      allowedNames.push(name);
    }

    const finalTools = request.slotPolicy?.applyCliDescriptionPreferences
      ? applyArchitectureCliToolPreferences(allowedTools, architectureContext)
      : allowedTools;

    this.appendHostFsDenials({
      runtimeKind: request.runtimeKind,
      personaNames,
      allowedNames: new Set(allowedNames),
      denied,
      architectureContext,
      toolByName,
    });

    if (request.runtimeKind === 'agent-flow-branch') {
      this.appendAgentFlowBranchScopeWarnings({
        baselineNames: new Set(launchNames ?? slotNames ?? [...personaNames]),
        allowedNames: new Set(allowedNames),
        denied,
        architectureContext,
        warnings,
      });
    }

    return {
      tools: finalTools,
      source,
      allowedToolNames: allowedNames,
      denied,
      warnings,
    };
  }

  private appendAgentFlowBranchScopeWarnings(input: {
    baselineNames: Set<string>;
    allowedNames: Set<string>;
    denied: ToolPolicyDecision['denied'];
    architectureContext?: Record<string, unknown>;
    warnings: string[];
  }): void {
    const hostFsDenied = input.denied.some((entry) => (
      HOST_FS_TOOL_NAMES.has(entry.name) && entry.reason === 'missing_project_path'
    ));
    const terminalDenied = input.denied.some((entry) => (
      TERMINAL_TOOL_NAMES.has(entry.name) && entry.reason === 'missing_execution_cwd'
    ));
    if (!hostFsDenied && !terminalDenied) {
      return;
    }

    const restriction = input.architectureContext?.['orchestratorScopeRestriction'];
    const orchestratorRestricted = restriction === true
      || (typeof restriction === 'object' && restriction !== null && !Array.isArray(restriction));

    if (orchestratorRestricted) {
      const message = 'Host filesystem/terminal tools restricted by orchestrator scope for this run.';
      if (!input.warnings.includes(message)) {
        input.warnings.push(message);
      }
      return;
    }

    const baselineAllowsHostFs = [...input.baselineNames].some((name) => HOST_FS_TOOL_NAMES.has(name));
    const baselineAllowsTerminal = [...input.baselineNames].some((name) => TERMINAL_TOOL_NAMES.has(name));
    if (
      (hostFsDenied && baselineAllowsHostFs)
      || (terminalDenied && baselineAllowsTerminal)
    ) {
      const message = hostFsDenied && terminalDenied
        ? 'Host filesystem and terminal tools require inherited projectPath/executionCwd from launch settings; child flow context is missing both scopes.'
        : hostFsDenied
          ? 'Host filesystem tools require inherited projectPath from launch settings; child flow context is missing project scope.'
          : 'Terminal tools require inherited executionCwd from launch settings; child flow context is missing execution scope.';
      if (!input.warnings.includes(message)) {
        input.warnings.push(message);
      }
    }
  }

  private appendHostFsDenials(input: {
    runtimeKind: SessionRuntimeKind;
    personaNames: Set<string>;
    allowedNames: Set<string>;
    denied: ToolPolicyDecision['denied'];
    architectureContext?: Record<string, unknown>;
    toolByName: Map<string, ToolMeta>;
  }): void {
    if (input.runtimeKind === 'chat') {
      return;
    }
    if (hasLocalProjectPath(input.architectureContext)) {
      return;
    }
    for (const name of input.personaNames) {
      if (!HOST_FS_TOOL_NAMES.has(name) || input.allowedNames.has(name) || !input.toolByName.has(name)) {
        continue;
      }
      if (!input.denied.some((entry) => entry.name === name)) {
        input.denied.push({ name, reason: 'missing_project_path' });
      }
    }
  }

  private resolvePersonaToolNames(allTools: ToolMeta[], personaConfig: PersonaSessionConfig | null): Set<string> {
    const filtered = this.filterToolsByPersona(
      allTools,
      personaConfig?.allowedTools,
      personaConfig?.mcpPolicy ?? 'allow_all',
    );
    return new Set(filtered.map((tool) => tool.name));
  }

  private filterToolsByPersona(
    tools: ToolMeta[],
    allowedTools?: string[],
    mcpPolicy: MCPPolicy = 'allow_all',
  ): ToolMeta[] {
    const nativeTools = tools.filter((toolMeta) => !toolMeta.name.startsWith('mcp_'));
    const mcpTools = tools.filter((toolMeta) => toolMeta.name.startsWith('mcp_'));
    const filteredNative = !allowedTools || allowedTools.length === 0
      ? nativeTools
      : nativeTools.filter((toolMeta) => allowedTools.includes(toolMeta.name));

    let filteredMcp: ToolMeta[];
    if (mcpPolicy === 'allow_all') {
      filteredMcp = mcpTools;
    } else if (mcpPolicy === 'deny_all') {
      filteredMcp = [];
    } else {
      const toolSet = new Set(allowedTools ?? []);
      filteredMcp = mcpTools.filter((toolMeta) => toolSet.has(toolMeta.name));
    }

    return [...filteredNative, ...filteredMcp];
  }

  private runtimeDenyReason(
    tool: ToolMeta,
    options: {
      runtimeKind: SessionRuntimeKind;
      architectureContext?: Record<string, unknown>;
      subagentDepth: number;
      stripRequiresConfirmation: boolean;
      autoApprove: Set<string>;
    },
  ): ToolDenyReason | null {
    if (SUBAGENT_TOOL_NAMES.has(tool.name) && options.subagentDepth > 1) {
      return 'subagent_depth_limit';
    }
    if (
      options.runtimeKind !== 'chat'
      && HOST_FS_TOOL_NAMES.has(tool.name)
      && !hasLocalProjectPath(options.architectureContext)
    ) {
      return 'missing_project_path';
    }
    if (
      options.runtimeKind !== 'chat'
      && TERMINAL_TOOL_NAMES.has(tool.name)
      && !hasExecutionCwd(options.architectureContext)
    ) {
      return 'missing_execution_cwd';
    }
    if (CLI_AGENT_TOOL_NAMES.has(tool.name) && !canUseCliAgents(options.architectureContext)) {
      return 'cli_unavailable';
    }
    if (
      tool.requiresConfirmation
      && options.stripRequiresConfirmation
      && !options.autoApprove.has(tool.name)
    ) {
      return 'requires_confirmation';
    }
    return null;
  }
}

function intersectSets(left: Set<string>, right: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const name of left) {
    if (right.has(name)) {
      result.add(name);
    }
  }
  return result;
}

function hasExecutionCwd(context: Record<string, unknown> | undefined): boolean {
  return typeof context?.['executionCwd'] === 'string' && context['executionCwd'].trim().length > 0;
}

function hasLocalProjectPath(context: Record<string, unknown> | undefined): boolean {
  const projectPath = context?.['projectPath'];
  if (typeof projectPath === 'string' && projectPath.trim().length > 0) {
    return true;
  }
  const executionCwd = context?.['executionCwd'];
  return typeof executionCwd === 'string' && executionCwd.trim().length > 0;
}

function canUseCliAgents(context: Record<string, unknown> | undefined): boolean {
  if (context?.['architectureCliAgentsEnabled'] === false) {
    return false;
  }
  const available = context?.['availableCliAgents'];
  return !Array.isArray(available) || available.some((value) => typeof value === 'string' && value.trim().length > 0);
}

function launchAllowedToolNames(context: Record<string, unknown> | undefined): string[] | undefined {
  const raw = context?.['launchAllowedToolNames'];
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}
