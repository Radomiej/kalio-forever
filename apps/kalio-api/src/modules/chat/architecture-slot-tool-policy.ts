import type { ArchitectureExecutionEvent, ArchitectureRoleSlot, ArchitectureSlotToolPolicy } from '@kalio/types';

const ARCHITECTURE_BRANCH_TOOL_NAMES = new Set([
  'vfs_list',
  'vfs_read',
  'vfs_grep_search',
  'vfs_file_search',
]);
const ARCHITECTURE_TOOL_EXECUTOR_TOOL_NAMES = new Set([
  ...ARCHITECTURE_BRANCH_TOOL_NAMES,
  'vfs_write',
]);
const ARCHITECTURE_PROJECT_READ_TOOL_NAMES = new Set(['fs_list', 'fs_read']);
const ARCHITECTURE_PROJECT_WRITE_TOOL_NAMES = new Set(['fs_write']);
const ARCHITECTURE_TERMINAL_TOOL_NAMES = new Set(['terminal_spawn', 'terminal_output', 'terminal_list']);
const ARCHITECTURE_SUBAGENT_TOOL_NAMES = new Set(['run_subagent', 'spawn_subagent', 'message_subagent']);
const ARCHITECTURE_CLI_AGENT_TOOL_NAMES = new Set([
  'spawn_cli_agent',
  'message_cli_agent',
  'get_cli_agent_status',
  'wait_for',
]);

export interface BuildArchitectureSlotToolPolicyInput {
  slot: ArchitectureRoleSlot;
  architectureContext?: Record<string, unknown>;
  incomingEvents?: ArchitectureExecutionEvent[];
}

export function buildArchitectureSlotToolPolicy(
  input: BuildArchitectureSlotToolPolicyInput,
): ArchitectureSlotToolPolicy | null {
  if (input.slot.slotType === 'finalizer') {
    return { allowedToolNames: [] };
  }

  const context = input.architectureContext;
  const hasLocalProjectContext = hasLocalProjectPath(context);
  const canUseCliAgents = canUseCliAgentsForSlot(context, input.slot);
  const gateImplementationReads = isImplementationWriterSlot(input.slot)
    && hasIncomingReadEvidence(input.incomingEvents);
  const allowed = new Set<string>();

  if (input.slot.slotType === 'tool_executor') {
    for (const name of ARCHITECTURE_TOOL_EXECUTOR_TOOL_NAMES) {
      if (!gateImplementationReads || !ARCHITECTURE_BRANCH_TOOL_NAMES.has(name)) {
        allowed.add(name);
      }
    }
    if (canUseCliAgents) {
      allowed.add('get_cli_agent_status');
      allowed.add('wait_for');
    }
    if (canUseCliAgents && isImplementationWriterSlot(input.slot)) {
      for (const name of ARCHITECTURE_CLI_AGENT_TOOL_NAMES) {
        allowed.add(name);
      }
    }
    if (hasLocalProjectContext) {
      if (!gateImplementationReads) {
        for (const name of ARCHITECTURE_PROJECT_READ_TOOL_NAMES) {
          allowed.add(name);
        }
      }
      for (const name of ARCHITECTURE_PROJECT_WRITE_TOOL_NAMES) {
        allowed.add(name);
      }
    }
    if (!gateImplementationReads && hasExecutionCwd(context)) {
      for (const name of ARCHITECTURE_TERMINAL_TOOL_NAMES) {
        allowed.add(name);
      }
    }
    return { allowedToolNames: [...allowed], applyCliDescriptionPreferences: true };
  }

  if (isOrchestrationSlot(input.slot)) {
    for (const name of ARCHITECTURE_BRANCH_TOOL_NAMES) {
      allowed.add(name);
    }
    if (canUseOrchestratorSubagents(context)) {
      for (const name of ARCHITECTURE_SUBAGENT_TOOL_NAMES) {
        allowed.add(name);
      }
    }
    if (canUseCliAgents) {
      for (const name of ARCHITECTURE_CLI_AGENT_TOOL_NAMES) {
        allowed.add(name);
      }
    }
    if (canUseCliAgents && canUseCliStop(context)) {
      allowed.add('stop_cli_agent');
    }
    if (hasLocalProjectContext) {
      for (const name of ARCHITECTURE_PROJECT_READ_TOOL_NAMES) {
        allowed.add(name);
      }
    }
    return { allowedToolNames: [...allowed], applyCliDescriptionPreferences: true };
  }

  if (input.slot.slotType === 'judge') {
    for (const name of ARCHITECTURE_BRANCH_TOOL_NAMES) {
      allowed.add(name);
    }
    allowed.add('run_subagent');
    if (canUseCliAgents) {
      allowed.add('get_cli_agent_status');
      allowed.add('wait_for');
    }
    if (hasLocalProjectContext) {
      for (const name of ARCHITECTURE_PROJECT_READ_TOOL_NAMES) {
        allowed.add(name);
      }
    }
    return { allowedToolNames: [...allowed], applyCliDescriptionPreferences: true };
  }

  if (isGoalGuardProofImplementer(input)) {
    for (const name of ARCHITECTURE_BRANCH_TOOL_NAMES) {
      allowed.add(name);
    }
    allowed.add('vfs_write');
    if (canAutoApproveProjectWrites(context)) {
      allowed.add('fs_write');
    }
    if (hasLocalProjectContext) {
      for (const name of ARCHITECTURE_PROJECT_READ_TOOL_NAMES) {
        allowed.add(name);
      }
    }
    return { allowedToolNames: [...allowed], applyCliDescriptionPreferences: true };
  }

  for (const name of ARCHITECTURE_BRANCH_TOOL_NAMES) {
    allowed.add(name);
  }
  if (hasLocalProjectContext) {
    for (const name of ARCHITECTURE_PROJECT_READ_TOOL_NAMES) {
      allowed.add(name);
    }
  }
  return {
    allowedToolNames: [...allowed].filter((name) => !requiresConfirmationByDefault(name)),
    stripRequiresConfirmation: true,
    applyCliDescriptionPreferences: true,
  };
}

function requiresConfirmationByDefault(toolName: string): boolean {
  return toolName === 'fs_write' || toolName === 'vfs_write' || toolName === 'terminal_spawn';
}

function hasIncomingReadEvidence(events: ArchitectureExecutionEvent[] | undefined): boolean {
  return (events ?? []).some((event) => {
    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
      return false;
    }
    const evidence = (event.data as Record<string, unknown>)['toolEvidence'];
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      return false;
    }
    const successfulToolNames = (evidence as Record<string, unknown>)['successfulToolNames'];
    return Array.isArray(successfulToolNames) && successfulToolNames.some((name) => (
      name === 'vfs_read'
      || name === 'vfs_list'
      || name === 'vfs_grep_search'
      || name === 'vfs_file_search'
      || name === 'fs_read'
      || name === 'fs_list'
    ));
  });
}

function hasExecutionCwd(context: Record<string, unknown> | undefined): boolean {
  return typeof context?.['executionCwd'] === 'string' && context['executionCwd'].trim().length > 0;
}

function canAutoApproveProjectWrites(context: Record<string, unknown> | undefined): boolean {
  return context?.['autoApproveArchitectureProjectWrites'] === true
    && hasLocalProjectPath(context);
}

function canUseCliStop(context: Record<string, unknown> | undefined): boolean {
  return context?.['allowArchitectureCliStop'] === true;
}

function canUseCliAgents(context: Record<string, unknown> | undefined): boolean {
  if (context?.['architectureCliAgentsEnabled'] === false) {
    return false;
  }
  const available = context?.['availableCliAgents'];
  return !Array.isArray(available) || available.some((value) => typeof value === 'string' && value.trim().length > 0);
}

function canUseCliAgentsForSlot(
  context: Record<string, unknown> | undefined,
  slot: ArchitectureRoleSlot,
): boolean {
  if (!canUseCliAgents(context)) {
    return false;
  }
  return !isOrchestrationSlot(slot) || canUseOrchestratorSubagents(context);
}

function canUseOrchestratorSubagents(context: Record<string, unknown> | undefined): boolean {
  return context?.['allowArchitectureOrchestratorSubagents'] === true;
}

function hasLocalProjectPath(context: Record<string, unknown> | undefined): boolean {
  const projectPath = context?.['projectPath'];
  if (typeof projectPath === 'string' && projectPath.trim().length > 0) {
    return true;
  }
  const executionCwd = context?.['executionCwd'];
  return typeof executionCwd === 'string' && executionCwd.trim().length > 0;
}

function isOrchestrationSlot(slot: ArchitectureRoleSlot): boolean {
  return slot.slotType === 'router' && /\borchestrator\b/i.test(`${slot.id} ${slot.label}`);
}

function isImplementationWriterSlot(slot: ArchitectureRoleSlot): boolean {
  return slot.id === 'implementer';
}

function isGoalGuardProofImplementer(input: BuildArchitectureSlotToolPolicyInput): boolean {
  return input.slot.id === 'implementer'
    && (
      input.architectureContext?.['requireGoalMasterLoopProof'] === true
      || input.architectureContext?.['requireImplementerWriteProof'] === true
    );
}

export function applyArchitectureCliToolPreferences(
  tools: import('@kalio/types').ToolMeta[],
  context: Record<string, unknown> | undefined,
): import('@kalio/types').ToolMeta[] {
  const preferences = cliAgentToolPreferences(context);
  if (!preferences) {
    return tools;
  }
  return tools.map((tool) => {
    if (
      !ARCHITECTURE_CLI_AGENT_TOOL_NAMES.has(tool.name)
      && tool.name !== 'run_cli_agent'
      && tool.name !== 'stop_cli_agent'
    ) {
      return tool;
    }
    return {
      ...tool,
      description: `${tool.description}\n\nArchitecture CLI preferences: ${preferences}`,
    };
  });
}

function cliAgentToolPreferences(context: Record<string, unknown> | undefined): string | null {
  const raw = context?.['cliAgentToolPreferences'];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const lines = Object.entries(raw as Record<string, unknown>)
    .map(([agentId, value]) => cliAgentPreferenceLine(agentId, value))
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  return lines.length > 0 ? lines.join(' | ') : null;
}

function cliAgentPreferenceLine(agentId: string, value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return `${agentId}: ${value.trim()}`;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const model = typeof record['model'] === 'string' && record['model'].trim().length > 0
    ? record['model'].trim()
    : null;
  const preference = typeof record['preference'] === 'string' && record['preference'].trim().length > 0
    ? record['preference'].trim()
    : null;
  if (model && preference) {
    return `${agentId} (model ${model}): ${preference}`;
  }
  if (model) {
    return `${agentId} (model ${model})`;
  }
  return preference ? `${agentId}: ${preference}` : null;
}
