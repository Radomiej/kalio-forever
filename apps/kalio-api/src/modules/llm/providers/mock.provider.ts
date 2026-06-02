import type { ILLMProvider, LLMToolDef, StreamChatOptions } from '../llm.types';
import type { LLMToolCall } from '@kalio/types';
import type { ContextManagedLLMMessage } from '../../../common/utils/context-managed-llm-message.util';

const MOCK_ERROR_429_TRIGGER = '[[mock:error:429]]';
const MOCK_ERROR_429_MESSAGE = '[MockLLM] LLM request failed: 429 Too Many Requests - { "error": { "code": "429", "message": "quota exhausted", "type": "limitation" } }';
const MOCK_RAAPP_CREATE_TRIGGER = '[[mock:tool:raapp_create]]';
const MOCK_RAAPP_CREATE_NO_ARG_PROGRESS_TRIGGER = '[[mock:tool:raapp_create:no-arg-progress]]';
const MOCK_VFS_WRITE_TRIGGER = '[[mock:tool:vfs_write]]';
const MOCK_VFS_WRITE_NO_ARG_PROGRESS_TRIGGER = '[[mock:tool:vfs_write:no-arg-progress]]';
const MOCK_FS_WRITE_TRIGGER = '[[mock:tool:fs_write]]';
const MOCK_RUN_SUB_AGENTFLOW_TRIGGER = '[[mock:tool:run_sub_agentflow]]';
const MOCK_GOAL_GUARD_VFS_SUCCESS_TRIGGER = '[[mock:goal-guard-vfs-success]]';
const MOCK_SCRIPT_START = '[[mock:script]]';
const MOCK_SCRIPT_END = '[[/mock:script]]';

type MockScriptAction =
  | { kind: 'wait'; ms: number }
  | { kind: 'return'; text: string };

type MockScriptCase = {
  matcher?: string;
  actions: MockScriptAction[];
};

export interface MockLLMProviderOptions {
  delay?: (ms: number) => Promise<void>;
}

function isFastMockMode(): boolean {
  return process.env.KALIO_MOCK_LLM_FAST === '1';
}

async function mockScriptDelay(ms: number): Promise<void> {
  if (isFastMockMode()) {
    return;
  }
  await defaultDelay(ms);
}

function contentToText(content: ContextManagedLLMMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(' ')
    .trim();
}

function getLastUserMessageText(messages: ContextManagedLLMMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return contentToText(messages[index].content);
    }
  }

  return '';
}

function extractMockScript(prompt: string): string | null {
  const start = prompt.indexOf(MOCK_SCRIPT_START);
  if (start < 0) return null;
  const bodyStart = start + MOCK_SCRIPT_START.length;
  const end = prompt.indexOf(MOCK_SCRIPT_END, bodyStart);
  return (end >= 0 ? prompt.slice(bodyStart, end) : prompt.slice(bodyStart)).trim();
}

function removeMockScript(prompt: string): string {
  const start = prompt.indexOf(MOCK_SCRIPT_START);
  if (start < 0) return prompt;
  const end = prompt.indexOf(MOCK_SCRIPT_END, start + MOCK_SCRIPT_START.length);
  if (end < 0) return prompt.slice(0, start).trim();
  return `${prompt.slice(0, start)}${prompt.slice(end + MOCK_SCRIPT_END.length)}`.trim();
}

function splitMockScriptStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;

  for (const char of script) {
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
    } else if (char === quote) {
      quote = null;
    } else if (quote === null && char === '(') {
      depth += 1;
    } else if (quote === null && char === ')') {
      depth = Math.max(0, depth - 1);
    }

    if (quote === null && depth === 0 && (char === ';' || char === '\n' || char === '\r')) {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

function parseMockScript(script: string): MockScriptCase[] {
  const lines = splitMockScriptStatements(script);
  const cases: MockScriptCase[] = [];
  const fallback: MockScriptCase = { actions: [] };

  for (const line of lines) {
    const matchedCase = /^when\((['"])(.*?)\1\)\s*(.*)$/i.exec(line);
    if (matchedCase) {
      cases.push({
        matcher: matchedCase[2],
        actions: parseMockScriptActions(matchedCase[3] ?? ''),
      });
      continue;
    }
    fallback.actions.push(...parseMockScriptActions(line));
  }

  if (fallback.actions.length > 0) {
    cases.push(fallback);
  }
  return cases;
}

function parseMockScriptActions(source: string): MockScriptAction[] {
  const actions: MockScriptAction[] = [];
  const actionPattern = /wait\((\d+)\)|return\((['"])([\s\S]*?)\2\)/gi;
  for (const match of source.matchAll(actionPattern)) {
    if (match[1] !== undefined) {
      actions.push({ kind: 'wait', ms: Number(match[1]) });
      continue;
    }
    actions.push({ kind: 'return', text: match[3] ?? '' });
  }
  return actions;
}

function selectMockScriptActions(prompt: string, cases: MockScriptCase[]): MockScriptAction[] | null {
  const runtimePrompt = removeMockScript(prompt);
  const matched = cases.find((scriptCase) => scriptCase.matcher && runtimePrompt.includes(scriptCase.matcher));
  if (matched) return matched.actions;
  return cases.find((scriptCase) => !scriptCase.matcher)?.actions ?? null;
}

function createRaappCreateToolCall(): LLMToolCall {
  return {
    id: `mock_tool_${Date.now()}`,
    name: 'raapp_create',
    args: {
      type: 'html',
      mode: 'interactive',
      content: '<!DOCTYPE html><html><head><title>Mock Tool Intent</title></head><body><h1>Mock Tool Intent</h1></body></html>',
    },
  };
}

function createVfsWriteToolCall(): LLMToolCall {
  return {
    id: `mock_tool_${Date.now()}`,
    name: 'vfs_write',
    args: {
      filePath: 'e2e/mock-tool-trigger.txt',
      content: 'mock-trigger-confirmation',
    },
  };
}

function extractMockField(prompt: string, name: string): string | null {
  const pattern = new RegExp(`\\[\\[mock:${name}=([\\s\\S]*?)\\]\\]`);
  return pattern.exec(prompt)?.[1]?.trim() ?? null;
}

function createFsWriteToolCall(prompt: string): LLMToolCall {
  return {
    id: `mock_tool_${Date.now()}`,
    name: 'fs_write',
    args: {
      path: extractMockField(prompt, 'fs_write_path') ?? 'mock-fs-write-proof.txt',
      content: extractMockField(prompt, 'fs_write_content') ?? 'mock-fs-write-confirmation',
    },
  };
}

function createRunSubAgentFlowToolCall(): LLMToolCall {
  return {
    id: `mock_tool_${Date.now()}`,
    name: 'run_sub_agentflow',
    args: {
      flowId: 'goal_guard_delivery_loop',
      goal: [
        'Run the two-agent Dev/Implementer <-> Goal Guard delivery loop.',
        'Require implementation evidence and pause if QA evidence is missing.',
        MOCK_GOAL_GUARD_VFS_SUCCESS_TRIGGER,
        '[[mock:script]]',
        'when("Slot: Orchestrator") return("route_to(implementer, run one implementation pass before guard review)")',
        'when("Slot: Implementer") return("Implementation complete; proof must be materialized and checked.")',
        'when("Slot: Tester") return("Regression check passed after reading materialized evidence.")',
        'when("Slot: Finalizer") return("Goal Guard accepted deterministic VFS evidence for the requested task.")',
        '[[/mock:script]]',
      ].join('\n'),
      context: {
        mockIntent: 'talk-started-agentflow',
        requireImplementerWriteProof: true,
      },
      startMode: 'blocking',
      returnMode: 'summary',
      maxSteps: 50,
    },
  };
}

function createGoalGuardVfsWriteToolCall(): LLMToolCall {
  return {
    id: `mock_tool_${Date.now()}`,
    name: 'vfs_write',
    args: {
      filePath: 'e2e/goal-guard-proof.json',
      content: JSON.stringify({
        status: 'implemented',
        evidence: 'deterministic mock proof for Goal Guard AgentFlow E2E',
      }),
    },
  };
}

function createGoalGuardVfsReadToolCall(): LLMToolCall {
  return {
    id: `mock_tool_${Date.now()}`,
    name: 'vfs_read',
    args: {
      filePath: 'e2e/goal-guard-proof.json',
    },
  };
}

function hasTool(tools: LLMToolDef[], name: string): boolean {
  return tools.some((tool) => tool.name === name);
}

function hasPriorToolResult(messages: ContextManagedLLMMessage[], toolName: string, targetPath?: string): boolean {
  const needle = `"name":"${toolName}"`;
  return messages.some((message) => {
    const role = String(message.role);
    if (role !== 'tool' && role !== 'tool_result') return false;
    const text = contentToText(message.content);
    return text.includes(needle) || (targetPath !== undefined && text.includes(targetPath));
  });
}

function hasPriorAssistantToolCall(messages: ContextManagedLLMMessage[], toolName: string, targetPath?: string): boolean {
  return messages.some((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.toolCalls)) return false;
    return message.toolCalls.some((toolCall) => {
      if (toolCall.name !== toolName) return false;
      if (targetPath === undefined) return true;
      const pathArg = toolCall.args['path'];
      return typeof pathArg === 'string'
        ? pathArg === targetPath
        : JSON.stringify(toolCall.args).includes(targetPath);
    });
  });
}

function hasPriorAgentFlowResult(messages: ContextManagedLLMMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== 'tool') return false;
    const text = contentToText(message.content);
    return text.includes('"flowRunId"') && text.includes('"childSessionId"');
  });
}

function emitText(options: StreamChatOptions, text: string): void {
  const { sessionId, messageId, onChunk } = options;
  onChunk({ delta: text, done: false, sessionId, messageId });
  onChunk({ delta: '', done: true, sessionId, messageId });
}

function emitMockToolArgProgress(options: StreamChatOptions, toolCall: LLMToolCall): void {
  const serializedArgs = JSON.stringify(toolCall.args);
  options.onToolArgChunk?.(toolCall.name, serializedArgs.length);
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
        (
          lastMessage.includes('Slot: Materializer')
          || (
            lastMessage.includes('Slot: Implementer')
            && lastMessage.includes('Implementation proof mode')
          )
        )
        && hasTool(tools, 'vfs_write')
      ) {
        if (hasPriorToolResult(messages, 'vfs_write', 'e2e/goal-guard-proof.json')) {
          const role = lastMessage.includes('Slot: Implementer') ? 'Implementer' : 'Materializer';
          emitText(options, `${role} wrote e2e/goal-guard-proof.json with vfs_write evidence.`);
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

    if (lastMessage.includes(MOCK_VFS_WRITE_NO_ARG_PROGRESS_TRIGGER)) {
      return [createVfsWriteToolCall()];
    }

    if (lastMessage.includes(MOCK_VFS_WRITE_TRIGGER)) {
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

    if (lastMessage.includes(MOCK_RUN_SUB_AGENTFLOW_TRIGGER) && hasTool(tools, 'run_sub_agentflow')) {
      if (hasPriorToolResult(messages, 'run_sub_agentflow') || hasPriorAgentFlowResult(messages)) {
        emitText(options, 'Goal Guard AgentFlow result is available in the parent chat.');
        return [];
      }
      const toolCall = createRunSubAgentFlowToolCall();
      emitMockToolArgProgress(options, toolCall);
      return [toolCall];
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

async function defaultDelay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
