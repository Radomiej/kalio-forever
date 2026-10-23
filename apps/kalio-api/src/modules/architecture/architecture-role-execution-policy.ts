import type { ArchitectureRoleSlot } from '@kalio/types';
import type { ArchitectureRoleExecutionInput } from './architecture-role-executor';

type CliBackendPolicy = {
  preferred?: string;
  allowed: string[];
  purpose: string;
};

export class ArchitectureRoleExecutionPolicy {
  public isHighLevelSlot(slot: ArchitectureRoleSlot): boolean {
    return slot.slotType === 'router'
      || slot.slotType === 'finalizer'
      || slot.slotType === 'judge'
      || slot.id === 'orchestrator'
      || slot.id === 'goal_master';
  }

  public autoApproveToolsForSlot(input: ArchitectureRoleExecutionInput): string[] | undefined {
    const canUseCliAgents = this.canUseCliAgentsForSlot(input.run.context, input.slot);
    if (input.slot.slotType === 'tool_executor') {
      const tools = ['vfs_write'];
      if (this.isImplementationWriterSlot(input.slot) && canUseCliAgents) {
        tools.push('spawn_cli_agent', 'message_cli_agent');
      }
      if (this.canAutoApproveProjectWrites(input.run.context)) {
        tools.push('fs_write');
      }
      if (this.canAutoApproveTerminal(input.run.context)) {
        tools.push('terminal_spawn');
      }
      return tools;
    }
    if (this.isOrchestrationSlot(input.slot)) {
      return canUseCliAgents
        ? ['vfs_write', 'spawn_cli_agent', 'message_cli_agent']
        : ['vfs_write'];
    }
    if (this.isGoalGuardProofImplementer(input)) {
      const tools = ['vfs_write'];
      if (this.canAutoApproveProjectWrites(input.run.context)) {
        tools.push('fs_write');
      }
      return tools;
    }
    return undefined;
  }

  public hasExecutionCwd(context: Record<string, unknown> | undefined): boolean {
    return typeof context?.['executionCwd'] === 'string' && context['executionCwd'].trim().length > 0;
  }

  public canAutoApproveProjectWrites(context: Record<string, unknown> | undefined): boolean {
    return context?.['autoApproveArchitectureProjectWrites'] === true
      && this.hasLocalProjectContext(context);
  }

  public canAutoApproveTerminal(context: Record<string, unknown> | undefined): boolean {
    return context?.['autoApproveArchitectureTerminal'] === true
      && this.hasExecutionCwd(context);
  }

  public canUseCliStop(context: Record<string, unknown> | undefined): boolean {
    return context?.['allowArchitectureCliStop'] === true;
  }

  public canUseCliAgents(context: Record<string, unknown> | undefined): boolean {
    if (context?.['architectureCliAgentsEnabled'] === false) {
      return false;
    }
    const available = context?.['availableCliAgents'];
    return !Array.isArray(available) || available.some((value) => typeof value === 'string' && value.trim().length > 0);
  }

  public canUseCliAgentsForSlot(
    context: Record<string, unknown> | undefined,
    slot: ArchitectureRoleSlot,
  ): boolean {
    if (!this.canUseCliAgents(context)) {
      return false;
    }
    return !this.isOrchestrationSlot(slot) || this.canUseOrchestratorSubagents(context);
  }

  public canUseOrchestratorSubagents(context: Record<string, unknown> | undefined): boolean {
    return context?.['allowArchitectureOrchestratorSubagents'] === true;
  }

  public hasLocalProjectContext(context: Record<string, unknown> | undefined): boolean {
    return this.localProjectPath(context) !== undefined;
  }

  public localProjectPath(context: Record<string, unknown> | undefined): string | undefined {
    const projectPath = context?.['projectPath'];
    if (typeof projectPath === 'string' && projectPath.trim().length > 0) {
      return projectPath.trim();
    }
    const executionCwd = context?.['executionCwd'];
    if (typeof executionCwd === 'string' && executionCwd.trim().length > 0) {
      return executionCwd.trim();
    }
    return undefined;
  }

  public cliBackendPolicyInstruction(input: ArchitectureRoleExecutionInput): string | null {
    if (!this.canUseCliAgentsForSlot(input.run.context, input.slot)) {
      return 'CLI agents are unavailable for this run. Do not call CLI-agent tools or claim CLI implementation proof; use Kalio sub-agents and visible VFS/tool evidence instead.';
    }
    const policy = this.cliBackendPolicyForSlot(input.run.context, input.slot);
    if (!policy) {
      return null;
    }
    const preferred = policy.preferred ? ` Preferred CLI backend: ${policy.preferred}.` : '';
    return [
      'CLI backend policy:',
      `${policy.purpose}.`,
      `${preferred} Allowed CLI backends: ${policy.allowed.join(', ')}.`,
      'When calling spawn_cli_agent, message_cli_agent, or run_cli_agent, set agentId explicitly from this policy; do not rely on the default Copilot adapter unless Copilot is the selected backend.',
      'If the selected CLI backend is unavailable or fails, record that evidence, choose the next allowed backend when appropriate, or continue with Kalio sub-agents instead of silently changing the architecture role.',
    ].join(' ');
  }

  public cliBackendPolicyForSlot(
    context: Record<string, unknown> | undefined,
    slot: ArchitectureRoleSlot,
  ): CliBackendPolicy | null {
    const configured = this.configuredCliBackendPolicyForSlot(context, slot.id);
    if (configured) {
      return configured;
    }
    if (this.isOrchestrationSlot(slot)) {
      return {
        allowed: ['gemini', 'copilot', 'codex'],
        purpose: 'Use Gemini for reconnaissance or brainstorming, Copilot for implementation delegation, and Codex for conservative analysis or final verification delegation',
      };
    }
    if (slot.id === 'implementer') {
      return {
        preferred: 'codex',
        allowed: ['codex', 'copilot'],
        purpose: 'Use Codex for implementation work; use Copilot only as an explicit fallback when Codex is unavailable or the run config selects Copilot',
      };
    }
    if (slot.id === 'verifier' || slot.id === 'tester') {
      return {
        preferred: 'codex',
        allowed: ['codex', 'gemini'],
        purpose: 'Use Codex for conservative verification; use Gemini only for broad analysis when Codex is unavailable',
      };
    }
    if (slot.slotType === 'judge') {
      return {
        preferred: 'codex',
        allowed: ['codex', 'gemini'],
        purpose: 'Use Codex for strict completion review and Gemini only for secondary brainstorming about unresolved weak points',
      };
    }
    return null;
  }

  public configuredCliBackendPolicyForSlot(
    context: Record<string, unknown> | undefined,
    slotId: string,
  ): CliBackendPolicy | null {
    const raw = context?.['cliBackendPolicy'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }
    const slotPolicy = (raw as Record<string, unknown>)[slotId] ?? (raw as Record<string, unknown>)['default'];
    if (!slotPolicy || typeof slotPolicy !== 'object' || Array.isArray(slotPolicy)) {
      return null;
    }
    const record = slotPolicy as Record<string, unknown>;
    const allowed = Array.isArray(record['allowed'])
      ? record['allowed'].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    if (allowed.length === 0) {
      return null;
    }
    const preferred = typeof record['preferred'] === 'string' && record['preferred'].trim().length > 0
      ? record['preferred'].trim()
      : undefined;
    const purpose = typeof record['purpose'] === 'string' && record['purpose'].trim().length > 0
      ? record['purpose'].trim()
      : 'Use the configured CLI backend policy for this architecture slot';
    return { preferred, allowed, purpose };
  }

  public isGoalGuardProofImplementer(input: ArchitectureRoleExecutionInput): boolean {
    return input.slot.id === 'implementer'
      && (
        input.run.context?.['requireGoalMasterLoopProof'] === true
        || input.run.context?.['requireImplementerWriteProof'] === true
      );
  }

  public isOrchestrationSlot(slot: ArchitectureRoleSlot): boolean {
    return slot.slotType === 'router' && /\borchestrator\b/i.test(`${slot.id} ${slot.label}`);
  }

  public isImplementationWriterSlot(slot: ArchitectureRoleSlot): boolean {
    return slot.id === 'implementer';
  }

  public canUseEvidenceToolsForSlot(
    slot: ArchitectureRoleSlot,
    context: Record<string, unknown> | undefined,
  ): boolean {
    if (slot.slotType === 'finalizer') {
      return false;
    }
    if (slot.slotType === 'router' && !this.isOrchestrationSlot(slot)) {
      return context?.['allowArchitectureRouterEvidenceTools'] === true;
    }
    return true;
  }

}
