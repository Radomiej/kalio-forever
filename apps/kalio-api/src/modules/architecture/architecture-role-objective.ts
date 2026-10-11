import type { ArchitectureContextPolicy } from '@kalio/types';
import type { ArchitectureRoleExecutionInput } from './architecture-role-executor';
import { ArchitectureRoleExecutionPolicy } from './architecture-role-execution-policy';
import { FINAL_ARTIFACT_CONTRACT_INSTRUCTION } from './architecture-final-artifact-contract';
import { summarizeArchitectureIncomingEvent, summarizeArchitectureIncomingHandoffPacket } from './architecture-incoming-event-summary';
import { incomingEventEvidenceSummary } from './architecture-role-evidence.utils';
import type { ArchitectureRoleSlot } from '@kalio/types';

type EffectiveContextPolicy = Required<Pick<
  ArchitectureContextPolicy,
  'includeUserTask'
  | 'includeProjectMemory'
  | 'includeBrowserSession'
  | 'includePriorDecisions'
>> & {
  includeOtherAgentOutputs: boolean;
  includeToolResults: boolean;
  contextCompression: NonNullable<ArchitectureContextPolicy['contextCompression']>;
};

export class ArchitectureRoleObjective extends ArchitectureRoleExecutionPolicy {
  public buildObjective(input: ArchitectureRoleExecutionInput): string {
    const outgoingNodeIds = input.outgoingNodeIds ?? [];
    const policy = this.contextPolicyForSlot(input.schema.contextPolicy, input.slot.id);
    const incomingEvents = policy.includeOtherAgentOutputs ? input.incomingEvents ?? [] : [];
    const lines = [
      `Architecture: ${input.schema.name} v${input.schema.version}`,
      `Slot: ${input.slot.label} (${input.slot.slotType})`,
      input.node ? `Node: ${input.node.label} (${input.node.kind})` : null,
      policy.includeUserTask ? `Task: ${input.run.prompt}` : null,
      '',
      this.instructionForSlot(
        input.slot,
        outgoingNodeIds,
        this.canUseCliAgentsForSlot(input.run.context, input.slot),
        this.canUseOrchestratorSubagents(input.run.context),
      ),
      this.goalGuardProofImplementerInstruction(input),
      this.cliBackendPolicyInstruction(input),
    ].filter((line): line is string => typeof line === 'string');
    if (incomingEvents.length > 0) {
      lines.push('', 'Incoming graph outputs:');
      for (const event of incomingEvents) {
        lines.push(`- ${event.roleSlotId ?? event.nodeId ?? event.type}: ${summarizeArchitectureIncomingEvent(event, input.slot.slotType)}${incomingEventEvidenceSummary(event)}`);
      }
      const handoffPackets = incomingEvents
        .map((event) => summarizeArchitectureIncomingHandoffPacket(event))
        .filter((packet): packet is string => packet !== undefined);
      if (handoffPackets.length > 0) {
        lines.push('', 'Incoming handoff packets:');
        for (const packet of handoffPackets) {
          lines.push(`- ${packet}`);
        }
      }
    }
    if (outgoingNodeIds.length > 0) {
      lines.push('', `Available next nodes: ${outgoingNodeIds.join(', ')}`);
    }
    const canUseEvidenceTools = this.canUseEvidenceToolsForSlot(input.slot, input.run.context);
    const attachedFilePaths = canUseEvidenceTools ? this.attachedFilePaths(input.run.context) : [];
    if (attachedFilePaths.length > 0) {
      if (this.isOrchestrationSlot(input.slot)) {
        lines.push(
          '',
          'Attached VFS project files for delegation:',
          ...attachedFilePaths.map((path) => `- ${path}`),
          '',
          'Use these paths in the task packet for the evidence owner. Do not read attached project files from this orchestrator slot by default unless the node editor explicitly configured this node to own direct evidence gathering.',
        );
      } else {
        lines.push(
          '',
          'Attached VFS project files:',
          ...attachedFilePaths.map((path) => `- ${path}`),
          '',
          'If your answer depends on file content, call vfs_read or vfs_grep_search first. Do not write "I will read" unless you actually call the tool.',
        );
      }
    }
    const localProjectPath = canUseEvidenceTools ? this.localProjectPath(input.run.context) : undefined;
    if (localProjectPath) {
      if (this.isOrchestrationSlot(input.slot)) {
        lines.push(
          '',
          `Local host project path for delegation: ${localProjectPath}`,
          'Use this path as delegation context in the task packet. Do not inspect host project files from this orchestrator slot by default; evidence gathering belongs to the routed researcher, implementer, verifier, or explicit child agent unless the node editor explicitly configured this node to own direct evidence gathering.',
          'When repository evidence is needed, route to the evidence owner with expected paths, acceptance criteria, and the exact evidence to return.',
        );
      } else {
        lines.push(
          '',
          `Local host project path: ${localProjectPath}`,
          'If your answer depends on host project files, call fs_list or fs_read first. Use fs_write only from tool-executor slots when an approved implementation write is required.',
          'Use fs_list for directories and fs_read only for files.',
          'If fs_read returns NOT_A_FILE, switch to fs_list for that path instead of retrying fs_read.',
          'Inspect only the minimum high-signal paths needed for your role, then conclude instead of recursively traversing the whole repository.',
        );
      }
    }
    const context = this.contextForObjective(input.run.context, policy);
    if (Object.keys(context).length > 0) {
      lines.push('', `Context: ${JSON.stringify(context)}`);
    }
    return lines.join('\n');
  }

  public contextPolicyForSlot(policy: ArchitectureContextPolicy, slotId: string): EffectiveContextPolicy {
    const override = policy.perSlotOverrides?.[slotId] ?? {};
    return {
      includeUserTask: override.includeUserTask ?? policy.includeUserTask,
      includeProjectMemory: override.includeProjectMemory ?? policy.includeProjectMemory,
      includeBrowserSession: override.includeBrowserSession ?? policy.includeBrowserSession,
      includePriorDecisions: override.includePriorDecisions ?? policy.includePriorDecisions,
      includeOtherAgentOutputs: override.includeOtherAgentOutputs ?? policy.includeOtherAgentOutputs ?? true,
      includeToolResults: override.includeToolResults ?? policy.includeToolResults ?? false,
      contextCompression: override.contextCompression ?? policy.contextCompression ?? 'none',
    };
  }

  public contextForObjective(
    context: Record<string, unknown> | undefined,
    policy: EffectiveContextPolicy,
  ): Record<string, unknown> {
    if (!context) {
      return {};
    }
    if (policy.contextCompression === 'evidence_only') {
      return this.pickDefined({
        evidence: context['evidence'],
        citations: context['citations'],
        toolResults: policy.includeToolResults ? context['toolResults'] : undefined,
      });
    }

    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (this.isRuntimeContextKey(key) || this.isControlledContextKey(key)) {
        continue;
      }
      filtered[key] = value;
    }
    if (policy.includeProjectMemory && context['projectMemory'] !== undefined) {
      filtered['projectMemory'] = context['projectMemory'];
    }
    if (policy.includeBrowserSession && context['browserSession'] !== undefined) {
      filtered['browserSession'] = context['browserSession'];
    }
    if (policy.includePriorDecisions && context['priorDecisions'] !== undefined) {
      filtered['priorDecisions'] = context['priorDecisions'];
    }
    if (policy.includeToolResults && context['toolResults'] !== undefined) {
      filtered['toolResults'] = context['toolResults'];
    }
    return filtered;
  }

  public pickDefined(entries: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
  }

  public attachedFilePaths(context: Record<string, unknown> | undefined): string[] {
    const filePaths = context?.['hydrateFilePaths'];
    return Array.isArray(filePaths)
      ? filePaths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      : [];
  }

  public isRuntimeContextKey(key: string): boolean {
    return key === 'parentSessionId'
      || key === 'maxArchitectureSteps'
      || key === 'maxArchitectureNodeVisits'
      || key === 'maxArchitectureSubagentIterations'
      || key === 'maxArchitectureSubagentIterationsBySlot'
      || key === 'maxArchitectureSubagentTimeoutMs'
      || key === 'maxArchitectureSubagentTimeoutMsBySlot'
      || key === 'cliBackendPolicy'
      || key === 'cliAgentToolPreferences'
      || key === 'architectureCliAgentsEnabled'
      || key === 'allowArchitectureOrchestratorSubagents'
      || key === 'availableCliAgents'
      || key === 'autoApproveArchitectureProjectWrites'
      || key === 'autoApproveArchitectureTerminal'
      || key === 'allowArchitectureCliStop'
      || key === 'requireGoalMasterLoopProof'
      || key === 'requireImplementerWriteProof'
      || key === 'hydrateFromSessionId'
      || key === 'hydrateTargetPrefix'
      || key === 'hydrateFilePaths';
  }

  public isControlledContextKey(key: string): boolean {
    return key === 'projectMemory'
      || key === 'browserSession'
      || key === 'priorDecisions'
      || key === 'toolResults'
      || key === 'evidence'
      || key === 'citations';
  }

  public instructionForSlot(
    slot: ArchitectureRoleSlot,
    outgoingNodeIds: string[],
    canUseCliAgents = true,
    canUseOrchestratorSubagents = false,
  ): string {
    if (slot.slotType === 'judge') {
      const routeHint = outgoingNodeIds.length > 0
        ? `Available next nodes are ${outgoingNodeIds.join(', ')}. If acceptance evidence is incomplete, set routerOutput.nextAction to "route_to", routerOutput.targetNodeId to the continuation node, and routerOutput.response to the reason. Route to the final artifact only when incoming graph outputs prove the goal is complete.`
        : 'Explain whether the incoming graph outputs prove the goal is complete.';
      return [
        'Act as a strict Goal Master judge.',
        'Use only the incoming graph outputs and provided evidence. Do not invent previous passes, hidden work, files, tests, or approvals.',
        'You may delegate focused review checks with synchronous run_subagent and inspect CLI child-session status, but do not spawn background review agents from this judge slot. Final acceptance must cite visible evidence from incoming outputs or tool results.',
        'If you mention a previous rejection, loop, pass, test, or artifact, it must be visible in the incoming graph outputs.',
        routeHint,
        'Return provider-native structured routerOutput with selectedStrategy, mergedDecision, acceptedInputs, rejectedInputs, unresolvedConflicts, risks, confidence, and nextAction.',
      ].join(' ');
    }
    if (slot.slotType === 'router') {
      const contract = 'Return provider-native structured routerOutput with selectedStrategy, mergedDecision, acceptedInputs, rejectedInputs, unresolvedConflicts, risks, confidence, and nextAction. When nextAction is "route_to", include targetNodeId and response.';
      if (this.isOrchestrationSlot(slot)) {
        const llmSubagentRule = canUseOrchestratorSubagents
          ? 'LLM sub-agents may be used only for focused checks when a graph node is not the right execution target.'
          : 'LLM sub-agent tools are disabled for this orchestrator slot.';
        const agentMap = canUseCliAgents
          ? `Treat CLI agents as delegated sub-agents at the architecture level: Copilot CLI is the implementation sub-agent backend, Codex CLI is the conservative development or code-analysis sub-agent backend, and Gemini CLI is the broad analysis or brainstorming sub-agent backend. Use spawn_cli_agent only when the architecture policy exposes it and a durable external child is explicitly required; otherwise route to the next graph node. ${llmSubagentRule}`
          : canUseOrchestratorSubagents
            ? 'CLI agents are not available in this run. Use Kalio sub-agent tools only for focused checks when a graph node is not the right execution target.'
            : 'CLI agents and LLM sub-agent tools are unavailable for this orchestrator slot; route to the next architecture node instead.';
        const routingRule = canUseOrchestratorSubagents
          ? 'When the next graph node is known, prefer a structured routerOutput route over spawning another child.'
          : 'This run keeps orchestration inside the architecture graph: do not call run_subagent, spawn_subagent, or message_subagent from the orchestrator. Choose the next architecture node with routerOutput.nextAction="route_to" and routerOutput.targetNodeId, then let that node execute the work.';
        return outgoingNodeIds.length > 0
          ? `Act as the delivery orchestrator. Define acceptance criteria, prepare a task packet with owner, expected evidence, verification command, and route graph execution. Do not perform project reconnaissance yourself by default; route evidence gathering to the responsible researcher, implementer, verifier, or explicit child agent unless this node has an explicit editor tool override for direct evidence gathering. ${agentMap} ${routingRule} Route to the next implementation node with structured routerOutput once the next step is clear. Do not claim files, tests, or completion unless visible tool output proves them. ${contract}`
          : `Act as the delivery orchestrator. Define acceptance criteria, prepare a task packet with owner, expected evidence, verification command, and route graph execution. Do not perform project reconnaissance yourself by default; route evidence gathering to the responsible researcher, implementer, verifier, or explicit child agent unless this node has an explicit editor tool override for direct evidence gathering. ${agentMap} ${routingRule} Do not claim files, tests, or completion unless visible tool output proves them. ${contract}`;
      }
      return outgoingNodeIds.length > 0
        ? `Act as a graph router. Synthesize only the incoming outputs. Do not claim files, tools, or capabilities unless incoming outputs explicitly prove them. When choosing a specific next node, emit structured routerOutput with nextAction="route_to", targetNodeId, and response. ${contract}`
        : `Act as a graph router. Synthesize only the incoming outputs and explain the routing decision. Do not claim files, tools, or capabilities unless incoming outputs explicitly prove them. ${contract}`;
    }
    if (slot.slotType === 'finalizer') {
      return [
        'Produce the final user-facing answer from the incoming graph outputs.',
        'Do not call tools or start a new investigation. Do not describe runtime mechanics unless they are relevant to the answer. Do not claim files, tools, or capabilities unless incoming outputs explicitly prove them.',
        FINAL_ARTIFACT_CONTRACT_INSTRUCTION,
      ].join(' ');
    }
    if (slot.slotType === 'tool_executor') {
      return [
        'Act as an execution slot, not a planner.',
        'Use the available tools to implement or verify the incoming architecture step.',
        'If this slot is an implementer, create or update the required artifacts first with vfs_write, fs_write, or a durable CLI child agent. An implementer cannot pass by only inspecting an existing artifact or running build/test commands; build-only work belongs to verifier slots. Do not spend early tool calls on environment probes such as node -v, npm -v, or git branch unless the incoming evidence says those probes are required before writing.',
        'If this implementer delegates writes to a CLI child, use spawn_cli_agent with expectedChangedFiles and verificationCommands when possible, then poll get_cli_agent_status and report the childSessionId, status, changed paths, and weak points. Do not spawn a second implementation path when an existing CLI child already owns the same work; poll or message that child instead.',
        'After an implementer has visible write evidence, it may run install/build commands when terminal tools are available, then report exact paths written and command results.',
        'If this slot is a verifier, use VFS or host-project reads as evidence unless terminal tools are available with an explicit execution cwd in context; when incoming evidence references a CLI child session, inspect it with get_cli_agent_status before judging the delegated work.',
        'When terminal tools are available, run the narrowest relevant command and report exact command, exit status, and tool output summary.',
        'If a required write or command needs human approval, request it through the tool flow and stop after reporting the pending approval.',
        'Do not claim runtime proof unless a visible tool result proves it.',
      ].join(' ');
    }
    return [
      'Return a concise role-specific contribution for the next graph node.',
      'If project files are attached or a local project path is available, gather only the smallest evidence batch you need with read/list tools, then stop calling tools and answer.',
      'After any successful file read/list result, produce a final answer with exactly: Recommendation, Evidence, Risk, Next step.',
      'Do not spend the full tool budget exploring; prefer a partial evidence-based conclusion over another read when the next useful action is already clear.',
    ].join(' ');
  }

  public goalGuardProofImplementerInstruction(input: ArchitectureRoleExecutionInput): string | null {
    if (!this.isGoalGuardProofImplementer(input)) {
      return null;
    }
    const projectWriteInstruction = this.canAutoApproveProjectWrites(input.run.context)
      ? ' When a local project path is configured, use fs_write for host project files.'
      : '';
    return `Implementation proof mode: the Implementer must create or update at least one artifact with vfs_write before completing.${projectWriteInstruction} A read-only recommendation is incomplete evidence for Goal Guard.`;
  }

}
