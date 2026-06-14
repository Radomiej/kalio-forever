import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import { needsWorkflowEnvelopeRecovery } from './workflowEnvelopeRecovery';

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'session-1',
    personaId: 'default',
    title: 'Workflow host',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

describe('needsWorkflowEnvelopeRecovery', () => {
  it('keeps polling when an architecture host only has the user prompt after reload', () => {
    const session = makeSession({
      updatedAt: 20,
      runtimeContext: {
        runtimeKind: 'chat',
        architectureContext: {
          schemaId: 'strategic-decision-council',
          schemaName: 'Strategic Decision Council',
        },
      },
    });

    expect(needsWorkflowEnvelopeRecovery({
      session,
      messages: [makeMessage({ role: 'user', content: 'Assess repo', createdAt: 10 })],
    })).toBe(true);
  });

  it('keeps polling when the loaded workflow projection is older than the session activity timestamp', () => {
    const session = makeSession({
      updatedAt: 500,
      runtimeContext: {
        runtimeKind: 'chat',
        architectureContext: {
          schemaId: 'strategic-decision-council',
          schemaName: 'Strategic Decision Council',
        },
      },
    });

    expect(needsWorkflowEnvelopeRecovery({
      session,
      messages: [
        makeMessage({
          id: 'workflow-summary',
          createdAt: 10,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'strategic-decision-council',
            status: 'completed',
            hostProjectionKind: 'workflow-envelope',
            trace: [],
            routeHops: [],
          },
        }),
      ],
    })).toBe(true);
  });

  it('stops polling once a terminal workflow projection is current', () => {
    const session = makeSession({
      updatedAt: 10,
      runtimeContext: {
        runtimeKind: 'chat',
        architectureContext: {
          schemaId: 'strategic-decision-council',
          schemaName: 'Strategic Decision Council',
        },
      },
    });

    expect(needsWorkflowEnvelopeRecovery({
      session,
      messages: [
        makeMessage({
          id: 'workflow-summary',
          createdAt: 10,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'strategic-decision-council',
            status: 'completed',
            hostProjectionKind: 'workflow-envelope',
            trace: [],
            routeHops: [],
          },
        }),
      ],
    })).toBe(false);
  });

  it('keeps polling when a completed workflow summary proves branch conversations exist but the sidebar still has none', () => {
    const session = makeSession({
      updatedAt: 10,
      runtimeContext: {
        runtimeKind: 'chat',
        architectureContext: {
          schemaId: 'strategic-decision-council',
          schemaName: 'Strategic Decision Council',
        },
      },
    });

    expect(needsWorkflowEnvelopeRecovery({
      session,
      visibleDescendantCount: 0,
      messages: [
        makeMessage({
          id: 'workflow-summary',
          createdAt: 10,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'strategic-decision-council',
            status: 'completed',
            hostProjectionKind: 'workflow-envelope',
            trace: [
              {
                speaker: 'participant',
                content: 'Analyst answer',
                eventId: 'event-1',
                stream: {
                  streamGroupId: 'run-live',
                  branchSessionId: 'arch-analyst',
                  status: 'completed',
                  chunkCount: 1,
                  text: 'Analyst answer',
                },
              },
            ],
            routeHops: [],
          },
        }),
      ],
    })).toBe(true);
  });

  it('stops polling once the visible descendant count catches up with proven branch conversations', () => {
    const session = makeSession({
      updatedAt: 10,
      runtimeContext: {
        runtimeKind: 'chat',
        architectureContext: {
          schemaId: 'strategic-decision-council',
          schemaName: 'Strategic Decision Council',
        },
      },
    });

    expect(needsWorkflowEnvelopeRecovery({
      session,
      visibleDescendantCount: 1,
      messages: [
        makeMessage({
          id: 'workflow-summary',
          createdAt: 10,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'strategic-decision-council',
            status: 'completed',
            hostProjectionKind: 'workflow-envelope',
            trace: [
              {
                speaker: 'participant',
                content: 'Analyst answer',
                eventId: 'event-1',
                stream: {
                  streamGroupId: 'run-live',
                  branchSessionId: 'arch-analyst',
                  status: 'completed',
                  chunkCount: 1,
                  text: 'Analyst answer',
                },
              },
            ],
            routeHops: [],
          },
        }),
      ],
    })).toBe(false);
  });
});
