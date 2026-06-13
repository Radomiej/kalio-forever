import { describe, expect, it } from 'vitest';
import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { buildArchitectureParentChatMessages } from './architecture-parent-chat-projection';

function makeSchema(): ArchitectureSchema {
  return {
    id: 'schema-1',
    name: 'Council',
    description: '',
    version: '1.0.0',
    roleSlots: [],
    nodes: [],
    edges: [],
    routerPolicy: {
      mode: 'rank_then_merge',
      mustAddressCriticFindings: false,
      canReturnNeedsMoreResearch: false,
    },
    contextPolicy: {
      includeUserTask: true,
      includeProjectMemory: false,
      includeBrowserSession: false,
      includePriorDecisions: false,
    },
    memoryPolicy: {
      persistFinalArtifact: false,
      persistRouterDecision: false,
    },
    outputArtifactSchema: 'Artifact',
  };
}

function makeRun(): ArchitectureRun {
  return {
    id: 'run-1',
    schemaId: 'schema-1',
    rootSessionId: 'root-1',
    prompt: 'Solve it',
    executionMode: 'subagent_execution',
    status: 'completed',
    createdAt: 1,
    updatedAt: 1,
    branchSessionIds: {
      analyst: 'branch-analyst-fallback',
    },
  };
}

describe('buildArchitectureParentChatMessages', () => {
  it('emits tool call/results for participant outputs and skips synthetic fan-out messages', () => {
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'e-synth',
        runId: 'run-1',
        sequence: 1,
        type: 'participant_output',
        nodeId: 'analyst-node',
        roleSlotId: 'analyst',
        message: 'Router started 2 outgoing paths.',
        createdAt: 10,
      },
      {
        id: 'e-real',
        runId: 'run-1',
        sequence: 2,
        type: 'participant_output',
        nodeId: 'analyst-node',
        roleSlotId: 'analyst',
        message: 'Risk-first recommendation',
        createdAt: 11,
        data: {
          stream: {
            branchSessionId: 'branch-analyst-stream',
          },
        },
      },
    ];

    const messages = buildArchitectureParentChatMessages(makeSchema(), makeRun(), 'parent-1', events, 100);

    expect(messages[1]?.toolCalls).toHaveLength(1);
    expect(messages[1]?.toolCalls?.[0]?.args).toMatchObject({
      childSessionId: 'branch-analyst-stream',
      roleSlotId: 'analyst',
    });
    expect(messages[2]?.role).toBe('tool_result');
    expect(messages[2]?.content).toContain('Risk-first recommendation');
    expect(messages[2]?.content).toContain('"vfsSessionId":"root-1"');
  });

  it('formats router/final text and removes runtime scaffold lines', () => {
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'e-router',
        runId: 'run-1',
        sequence: 1,
        type: 'router_decision',
        nodeId: 'router',
        message: '[MockLLM] Echo: Architecture: council\nIncoming graph outputs:\n- branch\nAvailable next nodes:\nfinal\nDecision summary',
        createdAt: 12,
        route: {
          source: 'router',
          fromNodeId: 'router',
          selectedNodeIds: ['final'],
          nextNodeId: 'final',
        },
      },
      {
        id: 'e-final',
        runId: 'run-1',
        sequence: 2,
        type: 'final_artifact',
        nodeId: 'artifact',
        message: 'Task: ignored scaffold only',
        createdAt: 13,
      },
    ];

    const messages = buildArchitectureParentChatMessages(makeSchema(), makeRun(), 'parent-1', events, 200);
    const routerText = messages.find((message) => message.id.includes('e-router'))?.content;
    const finalText = messages.find((message) => message.id.includes('e-final'))?.content;

    expect(routerText).toContain('### Router');
    expect(routerText).toContain('Route: router -> final');
    expect(routerText).toContain('Decision summary');
    expect(routerText).not.toContain('Incoming graph outputs');

    expect(finalText).toContain('### Finalizer');
    expect(finalText).toContain('Final answer produced from the routed graph outputs.');
  });

  it('skips synthetic router fan-out text in parent chat projection', () => {
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'e-router-synth',
        runId: 'run-1',
        sequence: 1,
        type: 'router_decision',
        nodeId: 'router',
        message: 'Router fanned out to pragmatist, researcher, synthesizer.',
        createdAt: 12,
      },
    ];

    const messages = buildArchitectureParentChatMessages(makeSchema(), makeRun(), 'parent-1', events, 200);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'architecture:run-1:user',
      role: 'user',
    });
  });

  it('includes a concise failure reason for failed architecture runs', () => {
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'e-failed',
        runId: 'run-1',
        sequence: 1,
        type: 'router_decision',
        message: 'Architecture run failed.',
        createdAt: 12,
        data: {
          error: '[XiaomiMiMo] LLM request failed: 401 Unauthorized\n{"error":{"message":"Invalid API Key"}}',
        },
      },
    ];

    const messages = buildArchitectureParentChatMessages(makeSchema(), makeRun(), 'parent-1', events, 200);
    const failureText = messages.find((message) => message.id.includes('e-failed'))?.content;

    expect(failureText).toContain('### Router');
    expect(failureText).toContain('Architecture run failed.');
    expect(failureText).toContain('Reason: [XiaomiMiMo] LLM request failed: 401 Unauthorized');
    expect(failureText).not.toContain('Invalid API Key');
  });

  it('shows incomplete architecture outputs in parent chat text', () => {
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'e-router-incomplete',
        runId: 'run-1',
        sequence: 1,
        type: 'router_decision',
        message: 'Sub-agent stopped after 6 tool iteration(s) without producing a final answer.',
        createdAt: 12,
        data: {
          incompleteReason: 'Subagent exhausted its tool loop without producing a final answer.',
        },
        route: {
          source: 'runtime_fallback',
          fromNodeId: 'router',
          selectedNodeIds: ['router'],
          nextNodeId: 'router',
          response: 'Subagent exhausted its tool loop without producing a final answer.',
        },
      },
    ];

    const messages = buildArchitectureParentChatMessages(makeSchema(), makeRun(), 'parent-1', events, 200);
    const incompleteText = messages.find((message) => message.id.includes('e-router-incomplete'))?.content;

    expect(incompleteText).toContain('### Router');
    expect(incompleteText).toContain('Incomplete: Subagent exhausted its tool loop without producing a final answer.');
    expect(incompleteText).toContain('Sub-agent stopped after 6 tool iteration(s) without producing a final answer.');
  });

  it('projects run_stopped as a terminal cancelled message in parent chat', () => {
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'e-stopped',
        runId: 'run-1',
        sequence: 1,
        type: 'run_stopped',
        message: 'Architecture run stopped by user.',
        createdAt: 12,
        data: {
          reasonCode: 'user_stop',
          stoppedByUser: true,
          previousStatus: 'running',
          source: 'user',
        },
      },
    ];
    const stoppedRun = {
      ...makeRun(),
      status: 'cancelled' as const,
    };

    const messages = buildArchitectureParentChatMessages(makeSchema(), stoppedRun, 'parent-1', events, 200);
    const stoppedText = messages.find((message) => message.id.includes('e-stopped'))?.content;

    expect(stoppedText).toContain('### Run stopped');
    expect(stoppedText).toContain('Status: cancelled');
    expect(stoppedText).toContain('Reason: Architecture run stopped by user.');
    expect(stoppedText).toContain('Reason code: user_stop');
  });
});
