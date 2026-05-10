import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ChatMessage, ToolMeta } from '@kalio/types';
import type { CountTokensInput, TokenCount } from '../../../services/tokenCounter';
import type { LLMHistoryMessage } from '../buildHistory';

type AgentStoreShape = {
  tools: ToolMeta[];
};

type SessionStoreShape = {
  activeSessionId: string | null;
  messages: ChatMessage[];
};

const {
  agentState,
  sessionState,
  countTokensMock,
  getCompactStrategyMock,
  buildHistoryMock,
  getToolCallingPromptMock,
  getCoreOsPromptMock,
} = vi.hoisted(() => ({
  agentState: {
    tools: [] as ToolMeta[],
  } satisfies AgentStoreShape,
  sessionState: {
    activeSessionId: null as string | null,
    messages: [] as ChatMessage[],
  } satisfies SessionStoreShape,
  countTokensMock: vi.fn<(input: CountTokensInput) => TokenCount>(),
  getCompactStrategyMock: vi.fn(),
  buildHistoryMock: vi.fn<(messages: ChatMessage[]) => LLMHistoryMessage[]>(),
  getToolCallingPromptMock: vi.fn(() => 'TOOL CALLING'),
  getCoreOsPromptMock: vi.fn(() => 'CORE PROMPT'),
}));

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: (selector: (state: AgentStoreShape) => unknown) => selector(agentState),
}));

vi.mock('../../../store/sessionStore', () => ({
  useSessionStore: () => sessionState,
}));

vi.mock('../../../services/tokenCounter', () => ({
  countTokens: countTokensMock,
}));

vi.mock('../../../services/compactStrategy', () => ({
  getCompactStrategy: getCompactStrategyMock,
}));

vi.mock('../buildHistory', () => ({
  buildHistory: buildHistoryMock,
}));

vi.mock('../../../services/modelPrompts', () => ({
  getToolCallingPrompt: getToolCallingPromptMock,
  getCoreOsPrompt: getCoreOsPromptMock,
}));

import { useContextUsage } from './useContextUsage';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'hello',
    createdAt: 1,
    ...overrides,
  };
}

describe('useContextUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentState.tools = [];
    sessionState.activeSessionId = null;
    sessionState.messages = [];
    countTokensMock.mockReturnValue({
      total: 117,
      breakdown: {
        systemPrompt: 10,
        tools: 2,
        skills: 0,
        history: 20,
        images: 85,
      },
      cacheable: 12,
      contextLimit: 32000,
      usagePercent: 0.36,
    });
    getCompactStrategyMock.mockReturnValue({
      compact: vi.fn((messages: ChatMessage[]) => messages.slice(-1)),
    });
  });

  it('builds the token count input from prompts, tools, session id, and multimodal history', () => {
    agentState.tools = [
      {
        name: 'web_search',
        description: 'Search the web for the user with detailed follow-up support.',
        parameters: {},
        requiresConfirmation: false,
      },
    ];
    sessionState.activeSessionId = 'session-1';
    sessionState.messages = [makeMessage()];
    buildHistoryMock.mockReturnValue([
      { role: 'assistant', content: 'assistant text' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'user text' },
          { type: 'image_url', image_url: { url: '/image.png', detail: 'auto' } },
        ],
      },
    ]);

    const { result } = renderHook(() => useContextUsage());

    expect(countTokensMock).toHaveBeenCalledWith({
      systemPromptText: 'CORE PROMPTTOOL CALLING\nCurrent session ID: session-1',
      skillsText: '',
      toolsText: '- web_search: Search the web for the user with detailed follow-up support.',
      historyTexts: ['assistant text', 'user text'],
      imageCount: 1,
      contextLimit: 32000,
      imageDetailMode: 'auto',
    });
    expect(result.current.tokenCount.total).toBe(117);
    expect(result.current.needsCompact).toBe(false);
  });

  it('flags oversized context and delegates compaction to the selected strategy', () => {
    const compact = vi.fn((messages: ChatMessage[]) => messages.slice(0, 1));
    countTokensMock.mockReturnValue({
      total: 40150,
      breakdown: {
        systemPrompt: 100,
        tools: 50,
        skills: 0,
        history: 40000,
        images: 0,
      },
      cacheable: 150,
      contextLimit: 32000,
      usagePercent: 125,
    });
    getCompactStrategyMock.mockReturnValue({ compact });
    buildHistoryMock.mockReturnValue([]);

    const { result } = renderHook(() => useContextUsage());
    const messages = [makeMessage(), makeMessage({ id: 'msg-2', content: 'two' })];

    expect(result.current.needsCompact).toBe(true);
    expect(result.current.compactMessages(messages, 'drop-oldest')).toEqual([messages[0]]);
    expect(getCompactStrategyMock).toHaveBeenCalledWith('drop-oldest');
    expect(compact).toHaveBeenCalledWith(messages, 32000);
  });
});
