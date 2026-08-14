import type { LLMToolDef, StreamChatOptions } from '../llm.types';
import type { LLMToolCall } from '@kalio/types';
import type { ContextManagedLLMMessage } from '../../../common/utils/context-managed-llm-message.util';

export const MOCK_ERROR_429_TRIGGER = '[[mock:error:429]]';
export const MOCK_ERROR_429_MESSAGE = '[MockLLM] LLM request failed: 429 Too Many Requests - { "error": { "code": "429", "message": "quota exhausted", "type": "limitation" } }';
export const MOCK_RAAPP_CREATE_TRIGGER = '[[mock:tool:raapp_create]]';
export const MOCK_RAAPP_CREATE_NO_ARG_PROGRESS_TRIGGER = '[[mock:tool:raapp_create:no-arg-progress]]';
export const MOCK_VFS_WRITE_TRIGGER = '[[mock:tool:vfs_write]]';
export const MOCK_VFS_WRITE_NO_ARG_PROGRESS_TRIGGER = '[[mock:tool:vfs_write:no-arg-progress]]';
export const MOCK_FS_WRITE_TRIGGER = '[[mock:tool:fs_write]]';
export const MOCK_RUN_SUBAGENT_HITL_TRIGGER = '[[mock:tool:run_subagent:hitl]]';
export const MOCK_RUN_SUBAGENT_AUTO_APPROVE_TRIGGER = '[[mock:tool:run_subagent:auto-approve]]';
export const MOCK_RUN_SUB_AGENTFLOW_TRIGGER = '[[mock:tool:run_sub_agentflow]]';
export const MOCK_ARCHITECTURE_ROUTER_MALFORMED_OUTPUT_TRIGGER = '[[mock:architecture:router:malformed-output]]';
export const MOCK_GOAL_GUARD_VFS_SUCCESS_TRIGGER = '[[mock:goal-guard-vfs-success]]';
const MOCK_SCRIPT_START = '[[mock:script]]';
const MOCK_SCRIPT_END = '[[/mock:script]]';

type MockScriptAction =
  | { kind: 'wait'; ms: number }
  | { kind: 'hold'; ms: number }
  | { kind: 'return'; text: string };

type MockScriptCase = {
  matcher?: string;
  actions: MockScriptAction[];
};

export function isFastMockMode(): boolean {
  return process.env.KALIO_MOCK_LLM_FAST === '1';
}

export async function mockScriptDelay(ms: number): Promise<void> {
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

export function getLastUserMessageText(messages: ContextManagedLLMMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return contentToText(messages[index].content);
    }
  }

  return '';
}

export function extractMockScript(prompt: string): string | null {
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

export function parseMockScript(script: string): MockScriptCase[] {
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
  const actionPattern = /hold\((\d+)\)|wait\((\d+)\)|return\((['"])([\s\S]*?)\3\)/gi;
  for (const match of source.matchAll(actionPattern)) {
    if (match[1] !== undefined) {
      actions.push({ kind: 'hold', ms: Number(match[1]) });
      continue;
    }
    if (match[2] !== undefined) {
      actions.push({ kind: 'wait', ms: Number(match[2]) });
      continue;
    }
    actions.push({ kind: 'return', text: match[4] ?? '' });
  }
  return actions;
}

export function selectMockScriptActions(prompt: string, cases: MockScriptCase[]): MockScriptAction[] | null {
  const runtimePrompt = removeMockScript(prompt);
  const matched = cases.find((scriptCase) => scriptCase.matcher && runtimePrompt.includes(scriptCase.matcher));
  if (matched) return matched.actions;
  return cases.find((scriptCase) => !scriptCase.matcher)?.actions ?? null;
}

export function createRaappCreateToolCall(): LLMToolCall {
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

export function extractRunRaappLaunchId(prompt: string): string | null {
  const match = /Use run_raapp with the exact id "([^"]+)" now/i.exec(prompt);
  return match?.[1]?.trim() || null;
}

export function createRunRaappToolCall(id: string): LLMToolCall {
  return {
    id: `mock_tool_${Date.now()}`,
    name: 'run_raapp',
    args: { id },
  };
}

export function createVfsWriteToolCall(): LLMToolCall {
  return {
    id: `mock_tool_${Date.now()}`,
    name: 'vfs_write',
    args: {
      filePath: 'e2e/mock-tool-trigger.txt',
      content: 'mock-trigger-confirmation',
    },
  };
}

export function extractMockField(prompt: string, name: string): string | null {
  const pattern = new RegExp(`\\[\\[mock:${name}=([\\s\\S]*?)\\]\\]`);
  return pattern.exec(prompt)?.[1]?.trim() ?? null;
}

export function createFsWriteToolCall(prompt: string): LLMToolCall {
  return {
    id: `mock_tool_${Date.now()}`,
    name: 'fs_write',
    args: {
      path: extractMockField(prompt, 'fs_write_path') ?? 'mock-fs-write-proof.txt',
      content: extractMockField(prompt, 'fs_write_content') ?? 'mock-fs-write-confirmation',
    },
  };
}

export function createRunSubagentToolCall(autoApproveChildTools = false): LLMToolCall {
  if (!autoApproveChildTools) {
    return {
      id: `mock_tool_${Date.now()}`,
      name: 'run_subagent',
      args: {
        inputPrompt: `${MOCK_VFS_WRITE_NO_ARG_PROGRESS_TRIGGER} Use exactly the vfs_write tool and nothing else.`,
        personaId: 'builder',
        vfsMode: 'shared',
      },
    };
  }

  return {
    id: `mock_tool_${Date.now()}`,
    name: 'run_subagent',
    args: {
      inputPrompt: `${MOCK_VFS_WRITE_NO_ARG_PROGRESS_TRIGGER} Use exactly the vfs_write tool and nothing else.`,
      personaId: 'builder',
      vfsMode: 'isolated',
      autoApproveTools: ['vfs_write'],
    },
  };
}

export function createRunSubAgentFlowToolCall(): LLMToolCall {
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
        'when("Slot: Implementer") return("Implementation complete with write evidence; proof must be checked.")',
        'when("Slot: Tester") return("Regression check passed after reading implementation evidence.")',
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

export function createGoalGuardVfsWriteToolCall(): LLMToolCall {
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

export function createGoalGuardVfsReadToolCall(): LLMToolCall {
  return {
    id: `mock_tool_${Date.now()}`,
    name: 'vfs_read',
    args: {
      filePath: 'e2e/goal-guard-proof.json',
    },
  };
}

export function hasTool(tools: LLMToolDef[], name: string): boolean {
  return tools.some((tool) => tool.name === name);
}

export function hasPriorToolResult(messages: ContextManagedLLMMessage[], toolName: string, targetPath?: string): boolean {
  return messages.some((message) => {
    const role = String(message.role);
    if (role !== 'tool' && role !== 'tool_result') return false;
    const result = parseToolResultObject(message.content);
    const matchingToolCall = findAssistantToolCallById(messages, message.toolCallId);
    const resultToolName = getToolResultName(result) ?? matchingToolCall?.name ?? null;
    if (resultToolName !== toolName) {
      return false;
    }
    return targetPath === undefined
      || recordContainsStringValue(result, targetPath)
      || recordContainsStringValue(matchingToolCall?.args, targetPath);
  });
}

export function hasPriorAssistantToolCall(messages: ContextManagedLLMMessage[], toolName: string, targetPath?: string): boolean {
  return messages.some((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.toolCalls)) return false;
    return message.toolCalls.some((toolCall) => {
      if (toolCall.name !== toolName) return false;
      if (targetPath === undefined) return true;
      const pathArg = toolCall.args['path'];
      return typeof pathArg === 'string'
        ? pathArg === targetPath
        : recordContainsStringValue(toolCall.args, targetPath);
    });
  });
}

export function hasPriorAgentFlowResult(messages: ContextManagedLLMMessage[]): boolean {
  return messages.some((message) => {
    const role = String(message.role);
    if (role !== 'tool' && role !== 'tool_result') return false;
    const result = parseToolResultObject(message.content);
    if (!result) return false;
    if (typeof result['flowRunId'] === 'string' && typeof result['childSessionId'] === 'string') {
      return true;
    }
    return result['domain'] === 'architecture'
      && result['kind'] === 'architecture_runtime'
      && typeof result['runId'] === 'string'
      && typeof result['rootSessionId'] === 'string';
  });
}

function parseToolResultObject(content: ContextManagedLLMMessage['content']): Record<string, unknown> | null {
  if (typeof content !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getToolResultName(result: Record<string, unknown> | null): string | null {
  const legacyName = result?.['name'];
  if (typeof legacyName === 'string') {
    return legacyName;
  }
  const typedName = result?.['toolName'];
  return typeof typedName === 'string' ? typedName : null;
}

function findAssistantToolCallById(
  messages: ContextManagedLLMMessage[],
  toolCallId: string | undefined,
): LLMToolCall | null {
  if (!toolCallId) {
    return null;
  }
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.toolCalls)) {
      continue;
    }
    const toolCall = message.toolCalls.find((candidate) => candidate.id === toolCallId);
    if (toolCall) {
      return toolCall;
    }
  }
  return null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordContainsStringValue(value: unknown, expected: string): boolean {
  if (typeof value === 'string') {
    return value === expected;
  }
  if (Array.isArray(value)) {
    return value.some((item) => recordContainsStringValue(item, expected));
  }
  if (isPlainRecord(value)) {
    return Object.values(value).some((item) => recordContainsStringValue(item, expected));
  }
  return false;
}

export function emitText(options: StreamChatOptions, text: string): void {
  const { sessionId, messageId, onChunk } = options;
  onChunk({ delta: text, done: false, sessionId, messageId });
  onChunk({ delta: '', done: true, sessionId, messageId });
}

export function emitMockToolArgProgress(options: StreamChatOptions, toolCall: LLMToolCall): void {
  const serializedArgs = JSON.stringify(toolCall.args);
  options.onToolArgChunk?.(toolCall.name, serializedArgs.length);
}

export async function defaultDelay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
