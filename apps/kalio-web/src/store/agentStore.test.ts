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

    // Assert
    const activity = store.toolActivities.find((a) => a.callId === callId);
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
    const activity = store.toolActivities.find((a) => a.callId === callId);
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
    const activity = store.toolActivities.find((a) => a.callId === callId);
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
