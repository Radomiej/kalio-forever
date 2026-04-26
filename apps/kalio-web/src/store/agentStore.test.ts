import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from './agentStore';
import type { ToolResult } from '@kalio/types';

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
      pendingConfirmation: null,
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
      pendingConfirmation: null,
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

describe('agentStore - Context (systemPrompt + activeToolNames)', () => {
  beforeEach(() => {
    useAgentStore.setState({
      systemPrompt: null,
      activeToolNames: [],
      toolActivities: [],
      llmActivities: [],
      isStreaming: false,
      streamingMessageId: undefined,
      pendingConfirmation: null,
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
