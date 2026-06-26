import type { ILLMProvider, LLMToolDef, StreamChatOptions } from '../llm.types';
import type { LLMToolCall } from '@kalio/types';
import type { ContextManagedLLMMessage } from '../../../common/utils/context-managed-llm-message.util';
import {
  createFsWriteToolCall,
  createGoalGuardVfsReadToolCall,
  createGoalGuardVfsWriteToolCall,
  createRaappCreateToolCall,
  createRunRaappToolCall,
  createRunSubagentToolCall,
  createRunSubAgentFlowToolCall,
  createVfsWriteToolCall,
  defaultDelay,
  emitMockToolArgProgress,
  emitText,
  extractMockField,
  extractRunRaappLaunchId,
  extractMockScript,
  getLastUserMessageText,
  hasPriorAgentFlowResult,
  hasPriorAssistantToolCall,
  hasPriorToolResult,
  hasTool,
  isFastMockMode,
  mockScriptDelay,
  MOCK_ERROR_429_MESSAGE,
  MOCK_ERROR_429_TRIGGER,
  MOCK_FS_WRITE_TRIGGER,
  MOCK_GOAL_GUARD_VFS_SUCCESS_TRIGGER,
  MOCK_RAAPP_CREATE_NO_ARG_PROGRESS_TRIGGER,
  MOCK_RAAPP_CREATE_TRIGGER,
  MOCK_RUN_SUBAGENT_AUTO_APPROVE_TRIGGER,
  MOCK_RUN_SUBAGENT_HITL_TRIGGER,
  MOCK_RUN_SUB_AGENTFLOW_TRIGGER,
  MOCK_VFS_WRITE_NO_ARG_PROGRESS_TRIGGER,
  MOCK_VFS_WRITE_TRIGGER,
  parseMockScript,
  selectMockScriptActions,
} from './mock.provider.helpers';

export interface MockLLMProviderOptions {
  delay?: (ms: number) => Promise<void>;
}

export class MockLLMProvider implements ILLMProvider {
  constructor(private readonly options: MockLLMProviderOptions = {}) {}

  async streamChat(
    messages: ContextManagedLLMMessage[],
    tools: LLMToolDef[],
    options: StreamChatOptions,
  ): Promise<LLMToolCall[]> {
    const { sessionId, messageId, onChunk, abortSignal } = options;
    const lastMessage = getLastUserMessageText(messages);
    if (lastMessage.includes(MOCK_GOAL_GUARD_VFS_SUCCESS_TRIGGER)) {
      if (
        lastMessage.includes('Slot: Implementer')
        && lastMessage.includes('Implementation proof mode')
        && hasTool(tools, 'vfs_write')
      ) {
        if (hasPriorToolResult(messages, 'vfs_write', 'e2e/goal-guard-proof.json')) {
          emitText(options, 'Implementer wrote e2e/goal-guard-proof.json with vfs_write evidence.');
          return [];
        }
        const toolCall = createGoalGuardVfsWriteToolCall();
        emitMockToolArgProgress(options, toolCall);
        return [toolCall];
      }

      if (
        (lastMessage.includes('Slot: Verifier') || lastMessage.includes('Slot: Goal Master'))
        && hasTool(tools, 'vfs_read')
      ) {
        if (hasPriorToolResult(messages, 'vfs_read', 'e2e/goal-guard-proof.json')) {
          const role = lastMessage.includes('Slot: Goal Master') ? 'Goal Master' : 'Verifier';
          emitText(options, `${role} confirmed e2e/goal-guard-proof.json after vfs_read evidence.`);
          return [];
        }
        const toolCall = createGoalGuardVfsReadToolCall();
        emitMockToolArgProgress(options, toolCall);
        return [toolCall];
      }
    }

    if (
      hasPriorAgentFlowResult(messages)
      && lastMessage.includes(MOCK_GOAL_GUARD_VFS_SUCCESS_TRIGGER)
    ) {
      emitText(options, 'Goal Guard AgentFlow result is available in the parent chat.');
      return [];
    }

    const script = extractMockScript(lastMessage);
    if (script) {
      const actions = selectMockScriptActions(lastMessage, parseMockScript(script)) ?? [];
      for (const action of actions) {
        if (abortSignal?.aborted) return [];
        if (action.kind === 'wait') {
          await (this.options.delay ?? mockScriptDelay)(action.ms);
          continue;
        }
        onChunk({ delta: action.text, done: false, sessionId, messageId });
      }
      if (!abortSignal?.aborted) {
        onChunk({ delta: '', done: true, sessionId, messageId });
      }
      return [];
    }

    if (lastMessage.includes(MOCK_ERROR_429_TRIGGER)) {
      throw new Error(MOCK_ERROR_429_MESSAGE);
    }

    if (lastMessage.includes(MOCK_RAAPP_CREATE_NO_ARG_PROGRESS_TRIGGER)) {
      return [createRaappCreateToolCall()];
    }

    if (lastMessage.includes(MOCK_RAAPP_CREATE_TRIGGER)) {
      const toolCall = createRaappCreateToolCall();
      emitMockToolArgProgress(options, toolCall);
      return [toolCall];
    }

    const runRaappLaunchId = extractRunRaappLaunchId(lastMessage);
    if (runRaappLaunchId && hasTool(tools, 'run_raapp')) {
      if (
        hasPriorToolResult(messages, 'run_raapp', runRaappLaunchId)
        || hasPriorAssistantToolCall(messages, 'run_raapp', runRaappLaunchId)
      ) {
        emitText(options, `run_raapp completed for ${runRaappLaunchId}.`);
        return [];
      }
      const toolCall = createRunRaappToolCall(runRaappLaunchId);
      emitMockToolArgProgress(options, toolCall);
      return [toolCall];
    }

    if (lastMessage.includes(MOCK_VFS_WRITE_NO_ARG_PROGRESS_TRIGGER)) {
      if (
        hasPriorToolResult(messages, 'vfs_write', 'e2e/mock-tool-trigger.txt')
        || hasPriorAssistantToolCall(messages, 'vfs_write', 'e2e/mock-tool-trigger.txt')
      ) {
        emitText(options, 'vfs_write completed for e2e/mock-tool-trigger.txt.');
        return [];
      }
      return [createVfsWriteToolCall()];
    }

    if (lastMessage.includes(MOCK_VFS_WRITE_TRIGGER)) {
      if (
        hasPriorToolResult(messages, 'vfs_write', 'e2e/mock-tool-trigger.txt')
        || hasPriorAssistantToolCall(messages, 'vfs_write', 'e2e/mock-tool-trigger.txt')
      ) {
        emitText(options, 'vfs_write completed for e2e/mock-tool-trigger.txt.');
        return [];
      }
      const toolCall = createVfsWriteToolCall();
      emitMockToolArgProgress(options, toolCall);
      return [toolCall];
    }

    if (lastMessage.includes(MOCK_FS_WRITE_TRIGGER) && hasTool(tools, 'fs_write')) {
      const targetPath = extractMockField(lastMessage, 'fs_write_path') ?? 'mock-fs-write-proof.txt';
      if (
        hasPriorToolResult(messages, 'fs_write', targetPath)
        || hasPriorAssistantToolCall(messages, 'fs_write', targetPath)
      ) {
        emitText(options, `fs_write completed for ${targetPath}.`);
        return [];
      }
      const toolCall = createFsWriteToolCall(lastMessage);
      emitMockToolArgProgress(options, toolCall);
      return [toolCall];
    }

    if (
      lastMessage.includes(MOCK_RUN_SUBAGENT_HITL_TRIGGER)
      && hasTool(tools, 'run_subagent')
    ) {
      if (hasPriorToolResult(messages, 'run_subagent') || hasPriorAssistantToolCall(messages, 'run_subagent')) {
        emitText(options, 'run_subagent completed for child HITL scenario.');
        return [];
      }
      const toolCall = createRunSubagentToolCall(false);
      emitMockToolArgProgress(options, toolCall);
      return [toolCall];
    }

    if (
      lastMessage.includes(MOCK_RUN_SUBAGENT_AUTO_APPROVE_TRIGGER)
      && hasTool(tools, 'run_subagent')
    ) {
      if (hasPriorToolResult(messages, 'run_subagent') || hasPriorAssistantToolCall(messages, 'run_subagent')) {
        emitText(options, 'run_subagent completed for child auto-approve scenario.');
        return [];
      }
      const toolCall = createRunSubagentToolCall(true);
      emitMockToolArgProgress(options, toolCall);
      return [toolCall];
    }

    if (lastMessage.includes(MOCK_RUN_SUB_AGENTFLOW_TRIGGER) && hasTool(tools, 'run_sub_agentflow')) {
      if (hasPriorToolResult(messages, 'run_sub_agentflow') || hasPriorAgentFlowResult(messages)) {
        emitText(options, 'Goal Guard AgentFlow result is available in the parent chat.');
        return [];
      }
      const toolCall = createRunSubAgentFlowToolCall();
      emitMockToolArgProgress(options, toolCall);
      return [toolCall];
    }

    if (isFastMockMode() && lastMessage.includes('Slot: ')) {
      emitText(options, `[MockLLM] Echo: ${lastMessage.slice(0, 240)}`);
      return [];
    }

    const response = `[MockLLM] Echo: ${lastMessage}`;
    const words = response.split(' ');

    for (const word of words) {
      if (abortSignal?.aborted) {
        return [];
      }
      await (this.options.delay ?? defaultDelay)(30);
      if (abortSignal?.aborted) {
        return [];
      }
      onChunk({ delta: word + ' ', done: false, sessionId, messageId });
    }

    if (!abortSignal?.aborted) {
      onChunk({ delta: '', done: true, sessionId, messageId });
    }
    return [];
  }
}
