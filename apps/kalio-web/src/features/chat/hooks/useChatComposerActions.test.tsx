import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@kalio/types';
import { useSessionStore } from '../../../store/sessionStore';
import { useChatComposerActions } from './useChatComposerActions';

const launch = vi.hoisted(() => ({ single: vi.fn(), workflow: vi.fn() }));
vi.mock('../launch/sessionLaunchShared', () => ({
  launchSingleChatPrompt: launch.single,
  launchWorkflowPrompt: launch.workflow,
}));

const workflowId = 'strategic-decision-council';
const single: ChatSession = {
  id: 'single', personaId: 'default', title: 'Single', createdAt: 1, updatedAt: 1,
};
const workflow: ChatSession = {
  ...single, id: 'workflow',
  runtimeContext: { runtimeKind: 'chat', architectureContext: { schemaId: workflowId } },
};
function mountComposer() {
  return renderHook(() => useChatComposerActions({
    architectures: [],
    lastSentContentRef: { current: '' }, projectPath: '',
    requestGeneratedTitleIfNeeded: vi.fn(), setAwaitingFirstChunk: vi.fn(),
    setDraftUserMessage: vi.fn(), setError: vi.fn(), setRetryError: vi.fn(),
  }));
}

describe('existing-chat composer mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ sessions: [workflow, single], activeSessionId: workflow.id,
      messages: [], sessionMessages: {} });
  });

  it('uses persisted workflow for follow-up and after a fresh composer mount', async () => {
    const first = mountComposer();
    await act(async () => first.result.current.handleComposerSend('Follow up', 'default'));
    expect(launch.workflow).toHaveBeenLastCalledWith(expect.objectContaining({
      session: workflow, schemaId: workflowId, content: 'Follow up',
    }));
    first.unmount();
    // Rehydrate the server snapshot with no welcome-screen selection or transcript.
    useSessionStore.setState({ sessions: [structuredClone(workflow), single] });
    const reloaded = mountComposer();
    await act(async () => reloaded.result.current.handleSendRef.current('After reload', 'default'));
    expect(launch.workflow).toHaveBeenLastCalledWith(expect.objectContaining({
      schemaId: workflowId, content: 'After reload',
    }));
    expect(launch.workflow).toHaveBeenCalledTimes(2);
    expect(launch.single).not.toHaveBeenCalled();
    reloaded.unmount();
  });

  it('keeps single chat single after switching from a workflow session', async () => {
    const composer = mountComposer();
    act(() => useSessionStore.setState({ activeSessionId: single.id }));
    await act(async () => composer.result.current.handleComposerSend('Single follow up', 'chosen', { interrupt: true }));
    expect(launch.single).toHaveBeenCalledWith(expect.objectContaining({
      session: single, personaId: 'chosen', interrupt: true,
    }));
    expect(launch.workflow).not.toHaveBeenCalled();
    composer.unmount();
  });

  it('passes an unavailable persisted schema to the workflow validation instead of sending single chat', async () => {
    useSessionStore.setState({ sessions: [{ ...workflow,
      runtimeContext: { runtimeKind: 'chat', architectureContext: { schemaId: 'removed-workflow' } },
    }] });
    const composer = mountComposer();
    await act(async () => composer.result.current.handleComposerSend('Retry', 'default'));
    expect(launch.workflow).toHaveBeenCalledWith(expect.objectContaining({ schemaId: 'removed-workflow' }));
    expect(launch.single).not.toHaveBeenCalled();
    composer.unmount();
  });

  it.each([undefined, 'single-chat'])('uses history only when persisted schema is absent (%s)', async (schemaId) => {
    useSessionStore.setState({ sessions: [{ ...workflow,
      runtimeContext: { runtimeKind: 'chat', architectureContext: { schemaId } },
    }] });
    useSessionStore.getState().setMessages([{
      id: 'completed-run', sessionId: workflow.id, role: 'assistant', content: '', createdAt: 1,
      architectureRun: { runId: 'run-1', schemaId: workflowId, status: 'completed', trace: [], routeHops: [] },
    }], workflow.id);
    const composer = mountComposer();
    await act(async () => composer.result.current.handleComposerSend('Continue', 'default'));
    if (schemaId) {
      expect(launch.single).toHaveBeenCalled();
      expect(launch.workflow).not.toHaveBeenCalled();
    } else {
      expect(launch.workflow).toHaveBeenCalledWith(expect.objectContaining({ schemaId: workflowId }));
      expect(launch.single).not.toHaveBeenCalled();
    }
    composer.unmount();
  });
});
