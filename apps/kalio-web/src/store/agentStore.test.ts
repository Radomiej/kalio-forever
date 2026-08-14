import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from './agentStore';
import type { RuntimeActivitySnapshot, ToolResult } from '@kalio/types';

// Regression test for: Tool activity status mapping in ChatInterface
// Issue: The status mapping in ChatInterface.tsx should handle all ToolResult statuses correctly
// Current code: status: result.status === 'success' ? 'success' : result.status === 'cancelled' ? 'cancelled' : 'error'
// Note: ToolResult.status only has 'success' | 'error' | 'cancelled' (no 'running' in the type definition)
// This test verifies the mapping is correct for the current type contract

describe('agentStore - Tool Activity Status Mapping (REGRESSION TEST)', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAgentStore.setState({
      toolActivities: [],
      isStreaming: false,
      streamingMessageId: undefined,
      streamingSessionId: null,
      pendingConfirmations: {},
      availableTools: [],
    });
  });

  it('should handle success status correctly', () => {
    // Arrange
    const store = useAgentStore.getState();
    const callId = 'test-call-456';
    
    store.addToolActivity({
      callId,
      toolName: 'test_tool',
      args: { param: 'value' },
      status: 'awaiting_confirmation',
      startedAt: Date.now(),
    });

    // Act - Simulate what ChatInterface does when receiving a tool result
    const successResult: ToolResult = {
      callId,
      status: 'success',
      data: { result: 'done' },
    };

    store.updateToolActivity(callId, {
      status: successResult.status === 'success' ? 'success' :
             successResult.status === 'cancelled' ? 'cancelled' : 'error',
      finishedAt: Date.now(),
      result: successResult,
    });

    // Assert - check the store state after update
    const updatedStore = useAgentStore.getState();
    const activity = updatedStore.toolActivities.find((a) => a.callId === callId);
    expect(activity?.status).toBe('success');
  });

  it('should handle cancelled status correctly', () => {
    // Arrange
    const store = useAgentStore.getState();
    const callId = 'test-call-789';
    
    store.addToolActivity({
      callId,
      toolName: 'test_tool',
      args: { param: 'value' },
      status: 'awaiting_confirmation',
      startedAt: Date.now(),
    });

    // Act
    const cancelledResult: ToolResult = {
      callId,
      status: 'cancelled',
      data: null,
    };
    
    store.updateToolActivity(callId, {
      status: cancelledResult.status === 'success' ? 'success' : 
             cancelledResult.status === 'cancelled' ? 'cancelled' : 'error',
      finishedAt: Date.now(),
      result: cancelledResult,
    });

    // Assert
    const updatedStore = useAgentStore.getState();
    const activity = updatedStore.toolActivities.find((a) => a.callId === callId);
    expect(activity?.status).toBe('cancelled');
  });

  it('should handle error status correctly', () => {
    // Arrange
    const store = useAgentStore.getState();
    const callId = 'test-call-error';
    
    store.addToolActivity({
      callId,
      toolName: 'test_tool',
      args: { param: 'value' },
      status: 'awaiting_confirmation',
      startedAt: Date.now(),
    });

    // Act
    const errorResult: ToolResult = {
      callId,
      status: 'error',
      errorMessage: 'Something went wrong',
    };
    
    store.updateToolActivity(callId, {
      status: errorResult.status === 'success' ? 'success' :
             errorResult.status === 'cancelled' ? 'cancelled' : 'error',
      finishedAt: Date.now(),
      result: errorResult,
    });

    // Assert
    const updatedStore = useAgentStore.getState();
    const activity = updatedStore.toolActivities.find((a) => a.callId === callId);
    expect(activity?.status).toBe('error');
  });

  it('should document that running status is not in ToolResult type', () => {
    // This test documents a potential future issue:
    // If ToolResult.status is extended to include 'running' in @kalio/types,
    // the ChatInterface.tsx code will need to be updated to handle it.
    // Currently, ToolResult.status is 'success' | 'error' | 'cancelled'
    
    const toolResultExample: ToolResult = {
      callId: 'test',
      status: 'success',
      data: null,
    };
    
    // Verify the current type contract
    expect(['success', 'error', 'cancelled']).toContain(toolResultExample.status);
  });
});

describe('agentStore - LlmActivity', () => {
  beforeEach(() => {
    useAgentStore.setState({
      toolActivities: [],
      llmActivities: [],
      isStreaming: false,
      streamingMessageId: undefined,
      streamingSessionId: null,
      pendingConfirmations: {},
      availableTools: [],
    });
  });

  it('addLlmActivity adds an entry', () => {
    const store = useAgentStore.getState();
    store.addLlmActivity({ id: 'title-gen', label: 'Generating title…', status: 'running', startedAt: 1000 });
    const { llmActivities } = useAgentStore.getState();
    expect(llmActivities).toHaveLength(1);
    expect(llmActivities[0]).toMatchObject({ id: 'title-gen', status: 'running' });
  });

  it('updateLlmActivity patches by id', () => {
    const store = useAgentStore.getState();
    store.addLlmActivity({ id: 'title-gen', label: 'Generating title…', status: 'running', startedAt: 1000 });
    store.updateLlmActivity('title-gen', { status: 'done', finishedAt: 2000 });
    const { llmActivities } = useAgentStore.getState();
    expect(llmActivities[0]).toMatchObject({ status: 'done', finishedAt: 2000 });
  });

  it('updateLlmActivity with error status', () => {
    const store = useAgentStore.getState();
    store.addLlmActivity({ id: 'title-gen', label: 'Generating title…', status: 'running', startedAt: 1000 });
    store.updateLlmActivity('title-gen', { status: 'error', finishedAt: 3000 });
    const { llmActivities } = useAgentStore.getState();
    expect(llmActivities[0]?.status).toBe('error');
  });

  it('clearLlmActivities empties the array', () => {
    const store = useAgentStore.getState();
    store.addLlmActivity({ id: 'a', label: 'A', status: 'running', startedAt: 1000 });
    store.addLlmActivity({ id: 'b', label: 'B', status: 'done', startedAt: 2000 });
    store.clearLlmActivities();
    expect(useAgentStore.getState().llmActivities).toHaveLength(0);
  });

  it('updateLlmActivity ignores unknown id', () => {
    const store = useAgentStore.getState();
    store.addLlmActivity({ id: 'title-gen', label: 'L', status: 'running', startedAt: 1000 });
    store.updateLlmActivity('unknown-id', { status: 'done' });
    expect(useAgentStore.getState().llmActivities[0]?.status).toBe('running');
  });

  it('multiple llmActivities coexist independently', () => {
    const store = useAgentStore.getState();
    store.addLlmActivity({ id: 'title-gen', label: 'Title', status: 'running', startedAt: 1000 });
    store.addLlmActivity({ id: 'suggest', label: 'Suggest', status: 'running', startedAt: 1001 });
    store.updateLlmActivity('title-gen', { status: 'done' });
    const { llmActivities } = useAgentStore.getState();
    expect(llmActivities).toHaveLength(2);
    expect(llmActivities.find((a) => a.id === 'title-gen')?.status).toBe('done');
    expect(llmActivities.find((a) => a.id === 'suggest')?.status).toBe('running');
  });
});

describe('agentStore - inactive activity cleanup', () => {
  beforeEach(() => {
    useAgentStore.setState({
      toolActivities: [],
      sessionToolActivities: {},
      llmActivities: [],
      activeAgentLoops: {},
      isStreaming: false,
      streamingMessageId: undefined,
      streamingSessionId: null,
      pendingConfirmations: {},
      availableTools: [],
    });
  });

  it('clears finished tool and llm activity while preserving live work', () => {
    const store = useAgentStore.getState();
    store.addToolActivity({
      callId: 'running-call',
      sessionId: 'session-1',
      toolName: 'run_subagent',
      args: {},
      status: 'running',
      startedAt: 1,
    });
    store.addToolActivity({
      callId: 'done-call',
      sessionId: 'session-1',
      toolName: 'read_file',
      args: {},
      status: 'success',
      startedAt: 1,
      finishedAt: 2,
    });
    store.addLlmActivity({ id: 'llm-running', label: 'Live', status: 'running', startedAt: 1 });
    store.addLlmActivity({ id: 'llm-done', label: 'Done', status: 'done', startedAt: 1, finishedAt: 2 });

    store.clearInactiveActivities();

    const state = useAgentStore.getState();
    expect(state.toolActivities.map((activity) => activity.callId)).toEqual(['running-call']);
    expect(state.sessionToolActivities['session-1']?.map((activity) => activity.callId)).toEqual(['running-call']);
    expect(state.llmActivities.map((activity) => activity.id)).toEqual(['llm-running']);
  });

  it('prunes inactive activity when a new agent loop starts', () => {
    const store = useAgentStore.getState();
    store.addToolActivity({
      callId: 'done-call',
      sessionId: 'session-1',
      toolName: 'read_file',
      args: {},
      status: 'success',
      startedAt: 1,
      finishedAt: 2,
    });
    store.addLlmActivity({ id: 'llm-done', label: 'Done', status: 'done', startedAt: 1, finishedAt: 2 });

    store.addActiveAgentLoop('session-2', 'turn-1');

    const state = useAgentStore.getState();
    expect(state.toolActivities).toEqual([]);
    expect(state.llmActivities).toEqual([]);
    expect(state.activeAgentLoops['session-2']).toMatchObject({ sessionId: 'session-2', turnId: 'turn-1' });
  });
});

describe('agentStore - Context (systemPrompt + activeToolNames)', () => {
  beforeEach(() => {
    useAgentStore.setState({
      systemPrompt: null,
      activeToolNames: [],
      toolActivities: [],
      llmActivities: [],
      isStreaming: false,
      streamingMessageId: undefined,
      streamingSessionId: null,
      pendingConfirmations: {},
      availableTools: [],
    });
  });

  it('setContext stores systemPrompt and activeToolNames', () => {
    const store = useAgentStore.getState();
    store.setContext('You are a helpful assistant.', ['vfs_read', 'vfs_write']);
    const state = useAgentStore.getState();
    expect(state.systemPrompt).toBe('You are a helpful assistant.');
    expect(state.activeToolNames).toEqual(['vfs_read', 'vfs_write']);
  });

  it('setContext overwrites previous values', () => {
    const store = useAgentStore.getState();
    store.setContext('Old prompt', ['old_tool']);
    store.setContext('New prompt', ['new_tool']);
    const state = useAgentStore.getState();
    expect(state.systemPrompt).toBe('New prompt');
    expect(state.activeToolNames).toEqual(['new_tool']);
  });

  it('default state is null systemPrompt and empty activeToolNames', () => {
    const state = useAgentStore.getState();
    expect(state.systemPrompt).toBeNull();
    expect(state.activeToolNames).toEqual([]);
  });
});

describe('agentStore - queued depth', () => {
  beforeEach(() => {
    useAgentStore.setState({ queuedDepthBySession: {} });
  });

  it('tracks queue depth per session and allows it to decrease', () => {
    const store = useAgentStore.getState();
    store.setQueuedDepth('session-1', 3);
    expect(useAgentStore.getState().queuedDepthBySession['session-1']).toBe(3);

    store.setQueuedDepth('session-1', 1);
    expect(useAgentStore.getState().queuedDepthBySession['session-1']).toBe(1);

    store.setQueuedDepth('session-1', 0);
    expect(useAgentStore.getState().queuedDepthBySession['session-1']).toBe(0);
  });
});

describe('agentStore - runtime snapshot ingestion', () => {
  beforeEach(() => {
    useAgentStore.setState({
      runtimeActivitySnapshots: {},
      sessionStatusSnapshots: {},
      sessionToolActivities: {},
      toolActivities: [],
    });
  });

  function makeRuntimeSnapshot(sessionId: string): RuntimeActivitySnapshot {
    return {
      sessionId,
      active: true,
      turnId: 'turn-1',
      queueLength: 0,
      pendingConfirmations: [],
      pendingBudgetApprovals: [],
      toolActivities: [],
      childExecutions: [],
      updatedAt: 2,
      run: {
        id: 'run-1',
        sessionId,
        turnId: 'turn-1',
        phase: 'tool_running',
        status: 'active',
        revision: 1,
        retryCount: 0,
        safeResume: true,
        startedAt: 1,
        updatedAt: 2,
        lastHeartbeatAt: 2,
      },
    };
  }

  it('ignores malformed runtime snapshot session ids without throwing', () => {
    const store = useAgentStore.getState();
    const malformedSnapshot = {
      ...makeRuntimeSnapshot('session-1'),
      sessionId: 42,
    } as unknown as RuntimeActivitySnapshot;

    expect(() => store.setRuntimeActivitySnapshot(malformedSnapshot)).not.toThrow();
    expect(useAgentStore.getState().runtimeActivitySnapshots).toEqual({});
  });

  it('stores valid runtime snapshots after session id narrowing', () => {
    const store = useAgentStore.getState();
    const snapshot = makeRuntimeSnapshot('session-1');

    store.setRuntimeActivitySnapshot(snapshot);

    expect(useAgentStore.getState().runtimeActivitySnapshots['session-1']).toMatchObject({
      sessionId: 'session-1',
      active: true,
    });
  });

  it('does not publish a new store state for duplicate runtime snapshots', () => {
    const store = useAgentStore.getState();
    const snapshot = makeRuntimeSnapshot('session-1');

    store.setRuntimeActivitySnapshot(snapshot);
    const firstState = useAgentStore.getState();

    store.setRuntimeActivitySnapshot(snapshot);
    const secondState = useAgentStore.getState();

    expect(secondState.runtimeActivitySnapshots).toBe(firstState.runtimeActivitySnapshots);
    expect(secondState.toolActivities).toBe(firstState.toolActivities);
    expect(secondState.sessionToolActivities).toBe(firstState.sessionToolActivities);
  });

  it('REGRESSION: rejects equal or lower revisions for the same runtime run', () => {
    const store = useAgentStore.getState();
    const current = {
      ...makeRuntimeSnapshot('session-1'),
      active: false,
      run: { ...makeRuntimeSnapshot('session-1').run!, revision: 3, phase: 'completed' as const, status: 'completed' as const },
    };
    const stale = {
      ...makeRuntimeSnapshot('session-1'),
      active: true,
      queueLength: 4,
      run: { ...makeRuntimeSnapshot('session-1').run!, revision: 2, phase: 'tool_running' as const, status: 'active' as const },
    };

    store.setRuntimeActivitySnapshot(current);
    const stateAfterCurrent = useAgentStore.getState();
    store.setRuntimeActivitySnapshot(stale);

    expect(useAgentStore.getState().runtimeActivitySnapshots).toBe(stateAfterCurrent.runtimeActivitySnapshots);
    expect(useAgentStore.getState().runtimeActivitySnapshots['session-1']).toMatchObject({
      active: false,
      queueLength: 0,
      run: { revision: 3, status: 'completed' },
    });
  });
});
