import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ChatMessage, ToolMeta } from '@kalio/types';
import type { CountTokensInput, TokenCount } from '../../../services/tokenCounter';
import type { LLMHistoryMessage } from '../buildHistory';

type AgentStoreShape = {
  tools: ToolMeta[];
  getContextForSession: (sessionId: string | null) => { systemPrompt: string | null; activeToolNames: string[] };
};

type SessionStoreShape = {
  activeSessionId: string | null;
  messages: ChatMessage[];
  streamingChunks: Record<string, string>;
  thinkingChunks: Record<string, string>;
  chunkSessionIds: Record<string, string>;
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
    getContextForSession: vi.fn<AgentStoreShape['getContextForSession']>(() => ({
      systemPrompt: null as string | null,
      activeToolNames: [] as string[],
    })),
  } satisfies AgentStoreShape,
  sessionState: {
    activeSessionId: null as string | null,
    messages: [] as ChatMessage[],
    streamingChunks: {} as Record<string, string>,
    thinkingChunks: {} as Record<string, string>,
    chunkSessionIds: {} as Record<string, string>,
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
    agentState.getContextForSession = vi.fn<AgentStoreShape['getContextForSession']>(() => ({ systemPrompt: null, activeToolNames: [] }));
    sessionState.activeSessionId = null;
    sessionState.messages = [];
    sessionState.streamingChunks = {};
    sessionState.thinkingChunks = {};
    sessionState.chunkSessionIds = {};
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

  it('recounts when active streaming chunks change without changing message count', () => {
    sessionState.activeSessionId = 'session-1';
    sessionState.messages = [makeMessage({ id: 'assistant-1', role: 'assistant', content: '', streaming: true })];
    sessionState.streamingChunks = { 'assistant-1': 'first chunk' };
    sessionState.chunkSessionIds = { 'assistant-1': 'session-1' };
    buildHistoryMock.mockImplementation((messages) => [
      { role: 'assistant', content: messages[0]?.content ?? '' },
    ]);

    const { rerender } = renderHook(() => useContextUsage());

    expect(buildHistoryMock).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'assistant-1', content: 'first chunk' }),
    ]);

    sessionState.streamingChunks = { 'assistant-1': 'first chunk plus more text' };
    rerender();

    expect(buildHistoryMock).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'assistant-1', content: 'first chunk plus more text' }),
    ]);
    expect(countTokensMock).toHaveBeenCalledTimes(2);
  });

  it('uses backend chat context prompt when available for the active session', () => {
    sessionState.activeSessionId = 'session-1';
    sessionState.messages = [makeMessage()];
    agentState.getContextForSession = vi.fn<AgentStoreShape['getContextForSession']>(() => ({
      systemPrompt: 'BACKEND SYSTEM PROMPT',
      activeToolNames: ['vfs_read'],
    }));
    buildHistoryMock.mockReturnValue([]);

    renderHook(() => useContextUsage());

    expect(countTokensMock).toHaveBeenCalledWith(expect.objectContaining({
      systemPromptText: 'BACKEND SYSTEM PROMPT',
    }));
  });
});
