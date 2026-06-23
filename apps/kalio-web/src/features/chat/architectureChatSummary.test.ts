import { describe, expect, it } from 'vitest';
import { architectureSessionIdForRunSlot, type ArchitectureGraphProjection } from '@kalio/types';
import {
  buildArchitectureRunChatTurnDrafts,
  buildArchitectureRunMetadata,
  buildArchitectureRunSummary,
  buildArchitectureRunTurnProjection,
  compactArchitectureTraceContent,
  findArchitectureRunInMessages,
} from './architectureChatSummary';

type ArchitectureMetadataWithGraph = ReturnType<typeof buildArchitectureRunMetadata> & {
  graphNodes?: ArchitectureGraphProjection['nodes'];
  graphEdges?: ArchitectureGraphProjection['edges'];
};

describe('buildArchitectureRunSummary', () => {
  it('projects a graph run into a flat chat-readable execution trace', () => {
    const summary = buildArchitectureRunSummary({
      run: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'completed',
        executionMode: 'session_branches',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
        routeHops: [
          {
            eventId: 'event-agent',
            source: 'runtime_fallback',
            fromNodeId: 'agent-1',
            toNodeId: 'router-1',
          },
          {
            eventId: 'event-router',
            source: 'router',
            fromNodeId: 'router-1',
            toNodeId: 'artifact',
          },
        ],
      },
      chat: {
        runId: 'run-1',
        messages: [
          {
            id: 'm0',
            eventId: 'event-created',
            speaker: 'system',
            content: 'Run created',
            createdAt: 1,
          },
          {
            id: 'm1',
            eventId: 'event-agent',
            speaker: 'participant',
            content: 'Agent 1 response',
            createdAt: 2,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'agent-1',
              selectedNodeIds: ['router-1'],
              rejectedNodeIds: [],
              nextNodeId: 'router-1',
            },
          },
          {
            id: 'm2',
            eventId: 'event-router',
            speaker: 'router',
            content: 'Router selected final artifact',
            createdAt: 3,
            route: {
              source: 'router',
              fromNodeId: 'router-1',
              selectedNodeIds: ['artifact'],
              rejectedNodeIds: [],
              nextNodeId: 'artifact',
            },
          },
          {
            id: 'm3',
            eventId: 'event-final',
            speaker: 'finalizer',
            content: 'Final decision text',
            createdAt: 4,
          },
        ],
      },
    });

    expect(summary).toContain('Architecture run completed: strategic-decision-council');
    expect(summary).toContain('Final artifact:\nFinal decision text');
    expect(summary).toContain('Execution trace:');
    expect(summary).toContain('1. participant -> router-1: Agent 1 response');
    expect(summary).toContain('2. router -> artifact: Router selected final artifact');
    expect(summary).toContain('3. finalizer: Final decision text');
    expect(summary).toContain('- runtime_fallback: agent-1 -> router-1');
    expect(summary).toContain('- router: router-1 -> artifact');
  });

  it('does not label in-flight architecture runs as completed', () => {
    const summary = buildArchitectureRunSummary({
      run: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'running',
        executionMode: 'session_branches',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
      },
      chat: {
        runId: 'run-1',
        messages: [],
      },
    });

    expect(summary).toContain('Architecture run running: strategic-decision-council');
    expect(summary).not.toContain('Architecture run completed');
  });
});

describe('compactArchitectureTraceContent', () => {
  it('strips raw tool call XML from trace cards', () => {
    expect(compactArchitectureTraceContent(
      'Before\n<tool_call>\n<function=list_directory>\n<parameter=path>C:\\repo</parameter>\n</tool_call>\nAfter',
      'participant',
    )).toBe('Before\n\nAfter');
  });

  it('removes architecture runtime prompt scaffolding from router output', () => {
    expect(compactArchitectureTraceContent(
      `[MockLLM] Echo: Architecture: Strategic Decision Council v0.1.0
Slot: Router (router)
Node: Router (router)
Task: What can you do?

Act as a graph router. Synthesize only the incoming outputs.

Incoming graph outputs:
- pragmatist: Pragmatist started.
- pragmatist: Pragmatist completed.

Available next nodes: final-artifact

router: Router completed.`,
      'router',
    )).toBe('Router completed synthesis for the next graph node.');
  });

  it('removes architecture runtime prompt scaffolding from finalizer output', () => {
    expect(compactArchitectureTraceContent(
      `[MockLLM] Echo: Architecture: Strategic Decision Council v0.1.0
Slot: Finalizer (finalizer)
Node: Final Artifact (artifact)
Task: What can you do?
Produce the final user-facing answer from the incoming graph outputs.
Incoming graph outputs:

router: Router started.
router: Router completed.`,
      'finalizer',
    )).toBe('Final answer produced from the routed graph outputs.');
  });
});

describe('buildArchitectureRunMetadata', () => {
  it('marks architecture summaries as workflow envelope projections', () => {
    const metadata = buildArchitectureRunMetadata({
      run: {
        id: 'run-envelope',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'running',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      graph: {
        runId: 'run-envelope',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-envelope',
        messages: [],
      },
    });

    expect(metadata.hostProjectionKind).toBe('workflow-envelope');
  });

  it('adds visit indices for repeated architecture node events', () => {
    const metadata = buildArchitectureRunMetadata({
      run: {
        id: 'run-1',
        schemaId: 'looping-router-chain',
        prompt: 'Loop.',
        status: 'completed',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'event-agent-1-first',
          runId: 'run-1',
          sequence: 1,
          type: 'participant_output',
          message: 'Agent first pass',
          nodeId: 'agent-1',
          roleSlotId: 'pragmatist',
          createdAt: 1,
        },
        {
          id: 'event-router-2-first',
          runId: 'run-1',
          sequence: 2,
          type: 'router_decision',
          message: 'Loop back',
          nodeId: 'router-2',
          roleSlotId: 'router',
          createdAt: 2,
        },
        {
          id: 'event-agent-1-second',
          runId: 'run-1',
          sequence: 3,
          type: 'participant_output',
          message: 'Agent second pass',
          nodeId: 'agent-1',
          roleSlotId: 'pragmatist',
          createdAt: 3,
        },
      ],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-1',
        messages: [
          {
            id: 'm1',
            eventId: 'event-agent-1-first',
            speaker: 'participant',
            content: 'Agent first pass',
            createdAt: 1,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'agent-1',
              selectedNodeIds: ['router-2'],
              nextNodeId: 'router-2',
            },
          },
          {
            id: 'm2',
            eventId: 'event-router-2-first',
            speaker: 'router',
            content: 'Loop back',
            createdAt: 2,
            route: {
              source: 'agent',
              fromNodeId: 'router-2',
              selectedNodeIds: ['agent-1'],
              nextNodeId: 'agent-1',
            },
          },
          {
            id: 'm3',
            eventId: 'event-agent-1-second',
            speaker: 'participant',
            content: 'Agent second pass',
            createdAt: 3,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'agent-1',
              selectedNodeIds: ['router-2'],
              nextNodeId: 'router-2',
            },
          },
        ],
      },
    });

    expect(metadata.trace.map((step) => ({
      eventId: step.eventId,
      nodeId: step.nodeId,
      visitIndex: step.visitIndex,
    }))).toEqual([
      { eventId: 'event-agent-1-first', nodeId: 'agent-1', visitIndex: 1 },
      { eventId: 'event-router-2-first', nodeId: 'router-2', visitIndex: 1 },
      { eventId: 'event-agent-1-second', nodeId: 'agent-1', visitIndex: 2 },
    ]);
  });

  it('carries branch stream snapshots from execution events into trace metadata', () => {
    const metadata = buildArchitectureRunMetadata({
      run: {
        id: 'run-1',
        schemaId: 'streamed-council',
        prompt: 'Stream branches.',
        status: 'completed',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'event-agent',
          runId: 'run-1',
          sequence: 1,
          type: 'participant_output',
          message: 'Agent streamed result',
          nodeId: 'agent-1',
          roleSlotId: 'pragmatist',
          data: {
            stream: {
              streamGroupId: 'architecture:run-1:agent-1',
              branchSessionId: 'branch-agent-1',
              status: 'completed',
              chunkCount: 3,
              text: 'Agent streamed result',
            },
          },
          createdAt: 1,
        },
      ],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-1',
        messages: [
          {
            id: 'm1',
            eventId: 'event-agent',
            speaker: 'participant',
            roleSlotId: 'pragmatist',
            content: 'Agent streamed result',
            createdAt: 1,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'agent-1',
              selectedNodeIds: ['router'],
              nextNodeId: 'router',
            },
          },
        ],
      },
    });

    expect(metadata.trace[0]?.stream).toEqual({
      streamGroupId: 'architecture:run-1:agent-1',
      branchSessionId: 'branch-agent-1',
      status: 'completed',
      chunkCount: 3,
      text: 'Agent streamed result',
    });
  });

  it('carries incomplete reasons from execution events into trace metadata', () => {
    const metadata = buildArchitectureRunMetadata({
      run: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'completed',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'event-router',
          runId: 'run-1',
          sequence: 1,
          type: 'router_decision',
          message: 'Sub-agent stopped after 6 tool iteration(s) without producing a final answer.',
          nodeId: 'router',
          roleSlotId: 'router',
          data: {
            incompleteReason: 'Subagent exhausted its tool loop without producing a final answer.',
          },
          createdAt: 1,
        },
      ],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-1',
        messages: [
          {
            id: 'm1',
            eventId: 'event-router',
            speaker: 'router',
            roleSlotId: 'router',
            content: 'Sub-agent stopped after 6 tool iteration(s) without producing a final answer.',
            createdAt: 1,
          },
        ],
      },
    });

    expect(metadata.trace[0]?.incompleteReason).toBe(
      'Subagent exhausted its tool loop without producing a final answer.',
    );
  });

  it('does not synthesize branch session metadata when events do not include stream snapshots', () => {
    const metadata = buildArchitectureRunMetadata({
      run: {
        id: 'run-1',
        schemaId: 'streamless-branches',
        prompt: 'Run branch.',
        status: 'completed',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-1',
        messages: [
          {
            id: 'm1',
            eventId: 'event-pragmatist',
            speaker: 'participant',
            roleSlotId: 'pragmatist',
            content: 'Pragmatist answer',
            createdAt: 1,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'pragmatist',
              selectedNodeIds: ['router'],
              nextNodeId: 'router',
            },
          },
        ],
      },
    });

    expect(metadata.trace[0]?.stream).toBeUndefined();
  });

  it('sanitizes router output fields before timeline rendering', () => {
    const metadata = buildArchitectureRunMetadata({
      run: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'completed',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'event-router',
          runId: 'run-1',
          sequence: 1,
          type: 'router_decision',
          message: 'Router decided',
          nodeId: 'router',
          roleSlotId: 'router',
          routerOutput: {
            selectedStrategy: 'final-artifact',
            mergedDecision: [
              '[MockLLM] Echo: Architecture: Strategic Decision Council v0.1.0',
              'Slot: Router (router)',
              'Node: Router (router)',
              'Task: What can you do?',
              '',
              'Act as a graph router. Synthesize only the incoming outputs.',
              '',
              'Incoming graph outputs:',
              '- pragmatist: Pragmatist started.',
              '- pragmatist: [MockLLM] Echo: Architecture: Strategic Decision Council v0.1.0',
              '',
              'Available next nodes: final-artifact',
            ].join('\n'),
            acceptedInputs: [
              {
                fromSlot: 'pragmatist',
                insight: '[MockLLM] Echo: Architecture: Strategic Decision Council v0.1.0\nSlot: Pragmatist',
              },
            ],
            rejectedInputs: [],
            unresolvedConflicts: [],
            risks: [],
            confidence: 0.55,
            nextAction: 'finalize',
          },
          createdAt: 1,
        },
      ],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-1',
        messages: [
          {
            id: 'm1',
            eventId: 'event-router',
            speaker: 'router',
            content: 'Router decided',
            createdAt: 1,
          },
        ],
      },
    });

    expect(metadata.trace[0]?.routerOutput?.mergedDecision).toBe('Router completed synthesis for the next graph node.');
    expect(metadata.trace[0]?.routerOutput?.acceptedInputs[0]?.insight).toBe('Router completed synthesis for the next graph node.');
    expect(JSON.stringify(metadata.trace[0]?.routerOutput)).not.toContain('Incoming graph outputs');
    expect(JSON.stringify(metadata.trace[0]?.routerOutput)).not.toContain('Act as a graph router');
    expect(JSON.stringify(metadata.trace[0]?.routerOutput)).not.toContain('[MockLLM]');
  });

  it('preserves graph node statuses for in-flight timeline stages', () => {
    const metadata = buildArchitectureRunMetadata({
      run: {
        id: 'run-live',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'running',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      graph: {
        runId: 'run-live',
        nodes: [
          { id: 'orchestrator', label: 'Orchestrator', kind: 'router', status: 'running', eventIds: ['event-router'] },
          { id: 'pragmatist', label: 'Pragmatist', kind: 'role', status: 'completed', eventIds: ['event-pragmatist'] },
          { id: 'analyst', label: 'Analyst', kind: 'role', status: 'pending', eventIds: [] },
          { id: 'synthesizer', label: 'Synthesizer', kind: 'router', status: 'pending', eventIds: [] },
          { id: 'final-artifact', label: 'Final Artifact', kind: 'artifact', status: 'pending', eventIds: [] },
        ],
        edges: [
          { id: 'edge-1', fromNodeId: 'orchestrator', toNodeId: 'pragmatist' },
          { id: 'edge-2', fromNodeId: 'orchestrator', toNodeId: 'analyst' },
          { id: 'edge-3', fromNodeId: 'pragmatist', toNodeId: 'synthesizer' },
          { id: 'edge-4', fromNodeId: 'analyst', toNodeId: 'synthesizer' },
          { id: 'edge-5', fromNodeId: 'synthesizer', toNodeId: 'final-artifact' },
        ],
        routeHops: [],
      },
      chat: {
        runId: 'run-live',
        messages: [
          {
            id: 'm1',
            eventId: 'event-router',
            speaker: 'router',
            roleSlotId: 'orchestrator',
            content: 'Orchestrator dispatched branches.',
            createdAt: 1,
            route: {
              source: 'router',
              fromNodeId: 'orchestrator',
              selectedNodeIds: ['pragmatist', 'analyst'],
              nextNodeId: 'pragmatist',
            },
          },
        ],
      },
    }) as ArchitectureMetadataWithGraph;

    expect(metadata.graphNodes?.map((node) => ({ id: node.id, status: node.status }))).toEqual([
      { id: 'orchestrator', status: 'running' },
      { id: 'pragmatist', status: 'completed' },
      { id: 'analyst', status: 'pending' },
      { id: 'synthesizer', status: 'pending' },
      { id: 'final-artifact', status: 'pending' },
    ]);
    expect(metadata.graphEdges).toHaveLength(5);
  });
});

describe('buildArchitectureRunChatTurnDrafts', () => {
  it('renders agent, router, and finalizer responses as flat chat turns', () => {
    const drafts = buildArchitectureRunChatTurnDrafts({
      run: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'completed',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-1',
        messages: [
          {
            id: 'm0',
            eventId: 'event-created',
            speaker: 'system',
            content: 'Run created',
            createdAt: 1,
          },
          {
            id: 'm1',
            eventId: 'event-parallel',
            speaker: 'router',
            content: 'Parallel Deliberation started 5 outgoing paths.',
            createdAt: 2,
          },
          {
            id: 'm2',
            eventId: 'event-agent',
            speaker: 'participant',
            roleSlotId: 'pragmatist',
            content: 'Real pragmatist response',
            createdAt: 3,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'agent-1',
              selectedNodeIds: ['router-1'],
              rejectedNodeIds: [],
              nextNodeId: 'router-1',
            },
          },
          {
            id: 'm3',
            eventId: 'event-router',
            speaker: 'router',
            roleSlotId: 'router',
            content: 'Real router response',
            createdAt: 4,
            route: {
              source: 'router',
              fromNodeId: 'router-1',
              selectedNodeIds: ['artifact'],
              rejectedNodeIds: [],
              nextNodeId: 'artifact',
            },
          },
          {
            id: 'm4',
            eventId: 'event-final',
            speaker: 'finalizer',
            roleSlotId: 'finalizer',
            content: 'Real final answer',
            createdAt: 5,
          },
        ],
      },
    });

    expect(drafts).toEqual([
      {
        content: '### Pragmatist\n\nRoute: runtime_fallback -> router-1\n\nReal pragmatist response',
        attachRunMetadata: false,
      },
      {
        content: '### Router\n\nRoute: router -> artifact\n\nReal router response',
        attachRunMetadata: false,
      },
      {
        content: '### Finalizer\n\nReal final answer',
        attachRunMetadata: true,
      },
    ]);
  });

  it('shows branch stream status in flat architecture chat turns', () => {
    const drafts = buildArchitectureRunChatTurnDrafts({
      run: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'completed',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'event-agent',
          runId: 'run-1',
          sequence: 1,
          type: 'participant_output',
          message: 'Real streamed response',
          nodeId: 'agent-1',
          roleSlotId: 'pragmatist',
          data: {
            stream: {
              streamGroupId: 'architecture:run-1:agent-1',
              branchSessionId: 'branch-agent-1',
              status: 'completed',
              chunkCount: 2,
              text: 'Real streamed response',
            },
          },
          createdAt: 1,
        },
      ],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-1',
        messages: [
          {
            id: 'm1',
            eventId: 'event-agent',
            speaker: 'participant',
            roleSlotId: 'pragmatist',
            content: 'Real streamed response',
            createdAt: 1,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'agent-1',
              selectedNodeIds: ['router'],
              nextNodeId: 'router',
            },
          },
        ],
      },
    });

    expect(drafts[0]?.content).toBe(
      '### Pragmatist\n\nStream: completed / 2 chunks / branch-agent-1\n\nRoute: runtime_fallback -> router\n\nReal streamed response',
    );
  });

  it('keeps flat architecture turns compact instead of dumping runtime objectives', () => {
    const drafts = buildArchitectureRunChatTurnDrafts({
      run: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'What can you do?',
        status: 'completed',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-1',
        messages: [
          {
            id: 'm1',
            eventId: 'event-agent',
            speaker: 'participant',
            roleSlotId: 'pragmatist',
            content: [
              '[MockLLM] Echo: Architecture: Strategic Decision Council v0.1.0',
              'Slot: Pragmatist (participant)',
              'Node: Pragmatist (role)',
              'Task: What can you do?',
              '',
              'Return a concise role-specific contribution for the next graph node.',
              '',
              'Incoming graph outputs:',
              '- parallel-deliberation: Parallel Deliberation started 5 outgoing paths.',
              '',
              'Available next nodes: router',
            ].join('\n'),
            createdAt: 1,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'pragmatist',
              selectedNodeIds: ['router'],
              nextNodeId: 'router',
            },
          },
        ],
      },
    });

    expect(drafts[0]?.content).toBe(
      '### Pragmatist\n\nRoute: runtime_fallback -> router\n\nBranch completed its role-specific response.',
    );
    expect(drafts[0]?.content).not.toContain('Incoming graph outputs');
    expect(drafts[0]?.content).not.toContain('Available next nodes');
    expect(drafts[0]?.content).not.toContain('Return a concise role-specific contribution');
  });

  it('shows incomplete warnings in flat architecture chat turns', () => {
    const drafts = buildArchitectureRunChatTurnDrafts({
      run: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'completed',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'event-router',
          runId: 'run-1',
          sequence: 1,
          type: 'router_decision',
          message: 'Sub-agent stopped after 6 tool iteration(s) without producing a final answer.',
          nodeId: 'router',
          roleSlotId: 'router',
          data: {
            incompleteReason: 'Subagent exhausted its tool loop without producing a final answer.',
          },
          createdAt: 1,
        },
      ],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-1',
        messages: [
          {
            id: 'm1',
            eventId: 'event-router',
            speaker: 'router',
            roleSlotId: 'router',
            content: 'Sub-agent stopped after 6 tool iteration(s) without producing a final answer.',
            createdAt: 1,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'router',
              selectedNodeIds: ['router'],
              nextNodeId: 'router',
            },
          },
        ],
      },
    });

    expect(drafts[0]?.content).toContain(
      'Incomplete: Subagent exhausted its tool loop without producing a final answer.',
    );
    expect(drafts[0]?.content).toContain(
      'Sub-agent stopped after 6 tool iteration(s) without producing a final answer.',
    );
  });
});

describe('buildArchitectureRunTurnProjection', () => {
  it('marks generated architecture turns as workflow envelopes', () => {
    const projection = buildArchitectureRunTurnProjection({
      run: {
        id: 'run-envelope',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'running',
        executionMode: 'subagent_execution',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      graph: {
        runId: 'run-envelope',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-envelope',
        messages: [],
      },
    }, 'session-1');

    expect(projection.turnKind).toBe('workflow-envelope');
    expect(projection.messages[0]?.architectureRun?.hostProjectionKind).toBe('workflow-envelope');
  });

  it('projects parallel participant branches as run_subagent calls in one chat turn', () => {
    const projection = buildArchitectureRunTurnProjection({
      run: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'completed',
        executionMode: 'subagent_execution',
        rootSessionId: 'root-1',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'event-agent',
          runId: 'run-1',
          sequence: 1,
          type: 'participant_output',
          message: 'Pragmatist answer',
          nodeId: 'pragmatist',
          roleSlotId: 'pragmatist',
          data: {
            stream: {
              streamGroupId: 'architecture:run-1:pragmatist',
              branchSessionId: 'branch-pragmatist',
              status: 'completed',
              chunkCount: 2,
              text: 'Pragmatist answer',
            },
          },
          createdAt: 3,
        },
      ],
      graph: {
        runId: 'run-1',
        nodes: [],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-1',
        messages: [
          {
            id: 'm1',
            eventId: 'event-agent',
            speaker: 'participant',
            roleSlotId: 'pragmatist',
            content: 'Pragmatist answer',
            createdAt: 3,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'pragmatist',
              selectedNodeIds: ['router'],
              nextNodeId: 'router',
            },
          },
          {
            id: 'm2',
            eventId: 'event-router',
            speaker: 'router',
            roleSlotId: 'router',
            content: 'Router answer',
            createdAt: 4,
            route: {
              source: 'router',
              fromNodeId: 'router',
              selectedNodeIds: ['artifact'],
              nextNodeId: 'artifact',
            },
          },
          {
            id: 'm3',
            eventId: 'event-final',
            speaker: 'finalizer',
            roleSlotId: 'finalizer',
            content: 'Final answer',
            createdAt: 5,
          },
        ],
      },
    }, 'parent-session');

    expect(projection.turnItems).toEqual([
      { kind: 'tool', callId: 'architecture:run-1:event-agent' },
      { kind: 'text', messageId: 'architecture:run-1:text:event-router' },
      { kind: 'text', messageId: 'architecture:run-1:text:event-final' },
    ]);
    expect(projection.messages[0]).toMatchObject({
      id: 'architecture:run-1:tool-calls',
      role: 'assistant',
      toolCalls: [{
        id: 'architecture:run-1:event-agent',
        name: 'run_subagent',
        args: {
          childSessionId: 'branch-pragmatist',
          roleSlotId: 'pragmatist',
        },
      }],
    });
    expect(projection.messages[1]).toMatchObject({
      role: 'tool_result',
      toolCallId: 'architecture:run-1:event-agent',
    });
    expect(JSON.parse(projection.messages[1]?.content ?? '{}')).toMatchObject({
      childSessionId: 'branch-pragmatist',
      parentSessionId: 'parent-session',
      result: 'Pragmatist answer',
    });
  });

  it('keeps participant branch tool calls when stream metadata is missing but graph session ids exist', () => {
    const projection = buildArchitectureRunTurnProjection({
      run: {
        id: 'run-missing-stream',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'completed',
        executionMode: 'subagent_execution',
        rootSessionId: 'root-1',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      graph: {
        runId: 'run-missing-stream',
        nodes: [
          {
            id: 'analyst',
            sessionId: 'arch-run-missing-analyst',
            label: 'Analyst',
            kind: 'role',
            status: 'completed',
            eventIds: ['event-analyst'],
          },
        ],
        edges: [],
        routeHops: [],
      },
      chat: {
        runId: 'run-missing-stream',
        messages: [
          {
            id: 'm1',
            eventId: 'event-analyst',
            speaker: 'participant',
            roleSlotId: 'analyst',
            content: 'Analyst answer',
            createdAt: 3,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'analyst',
              selectedNodeIds: ['router'],
              nextNodeId: 'router',
            },
          },
          {
            id: 'm2',
            eventId: 'event-router',
            speaker: 'router',
            roleSlotId: 'router',
            content: 'Router answer',
            createdAt: 4,
          },
        ],
      },
    }, 'parent-session');

    expect(projection.turnItems).toContainEqual({
      kind: 'tool',
      callId: 'architecture:run-missing-stream:event-analyst',
    });
    expect(projection.messages[0]).toMatchObject({
      role: 'assistant',
      toolCalls: [
        expect.objectContaining({
          args: expect.objectContaining({
            childSessionId: 'arch-run-missing-analyst',
          }),
        }),
      ],
    });
    expect(projection.messages[1]).toMatchObject({
      role: 'tool_result',
      toolCallId: 'architecture:run-missing-stream:event-analyst',
    });
  });

  it('attaches graph metadata to branch-only tool call turns for reload recovery', () => {
    const projection = buildArchitectureRunTurnProjection({
      run: {
        id: 'run-live',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'running',
        executionMode: 'subagent_execution',
        rootSessionId: 'root-1',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'event-pragmatist',
          runId: 'run-live',
          sequence: 1,
          type: 'participant_output',
          message: 'Pragmatist answer',
          nodeId: 'pragmatist',
          roleSlotId: 'pragmatist',
          createdAt: 3,
        },
      ],
      graph: {
        runId: 'run-live',
        nodes: [
          { id: 'parallel-deliberation', label: 'Parallel Deliberation', kind: 'parallel', status: 'running', eventIds: [] },
          { id: 'pragmatist', label: 'Pragmatist', kind: 'role', status: 'completed', eventIds: ['event-pragmatist'] },
          { id: 'innovator', label: 'Innovator', kind: 'role', status: 'pending', eventIds: [] },
          { id: 'router', label: 'Router', kind: 'router', status: 'pending', eventIds: [] },
          { id: 'final-artifact', label: 'Final Artifact', kind: 'artifact', status: 'pending', eventIds: [] },
        ],
        edges: [
          { id: 'edge-1', fromNodeId: 'parallel-deliberation', toNodeId: 'pragmatist' },
          { id: 'edge-2', fromNodeId: 'parallel-deliberation', toNodeId: 'innovator' },
          { id: 'edge-3', fromNodeId: 'pragmatist', toNodeId: 'router' },
          { id: 'edge-4', fromNodeId: 'innovator', toNodeId: 'router' },
          { id: 'edge-5', fromNodeId: 'router', toNodeId: 'final-artifact' },
        ],
        routeHops: [],
      },
      chat: {
        runId: 'run-live',
        messages: [
          {
            id: 'm-pragmatist',
            eventId: 'event-pragmatist',
            speaker: 'participant',
            roleSlotId: 'pragmatist',
            content: 'Pragmatist answer',
            createdAt: 3,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'pragmatist',
              selectedNodeIds: ['router'],
              nextNodeId: 'router',
            },
          },
        ],
      },
    }, 'parent-session');
    const summaryMessage = projection.messages.find((message) => message.architectureRun?.runId === 'run-live');

    expect(summaryMessage?.architectureRun?.trace.map((step) => step.nodeId)).toEqual(['pragmatist']);
    expect((summaryMessage?.architectureRun as ArchitectureMetadataWithGraph | undefined)?.graphNodes?.map((node) => node.id)).toEqual([
      'parallel-deliberation',
      'pragmatist',
      'innovator',
      'router',
      'final-artifact',
    ]);

    const reloaded = findArchitectureRunInMessages(projection.messages) as ArchitectureMetadataWithGraph | null;
    expect(reloaded?.runId).toBe('run-live');
    expect(reloaded?.graphNodes?.find((node) => node.id === 'final-artifact')?.status).toBe('pending');
  });

  it('projects deterministic branch tool results when a branch has no live stream metadata but the role slot is known', () => {
    const projection = buildArchitectureRunTurnProjection({
      run: {
        id: 'run-streamless',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        status: 'running',
        executionMode: 'subagent_execution',
        rootSessionId: 'root-1',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      graph: {
        runId: 'run-streamless',
        nodes: [
          { id: 'pragmatist', label: 'Pragmatist', kind: 'role', status: 'completed', eventIds: ['event-pragmatist'] },
          { id: 'router', label: 'Router', kind: 'router', status: 'pending', eventIds: [] },
        ],
        edges: [
          { id: 'edge-1', fromNodeId: 'pragmatist', toNodeId: 'router' },
        ],
        routeHops: [],
      },
      chat: {
        runId: 'run-streamless',
        messages: [
          {
            id: 'm1',
            eventId: 'event-pragmatist',
            speaker: 'participant',
            roleSlotId: 'pragmatist',
            content: 'Pragmatist answer',
            createdAt: 3,
            route: {
              source: 'runtime_fallback',
              fromNodeId: 'pragmatist',
              selectedNodeIds: ['router'],
              nextNodeId: 'router',
            },
          },
        ],
      },
    }, 'parent-session');

    const derivedBranchSessionId = architectureSessionIdForRunSlot('run-streamless', 'pragmatist');

    expect(projection.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        toolCalls: [
          expect.objectContaining({
            name: 'run_subagent',
            args: expect.objectContaining({
              childSessionId: derivedBranchSessionId,
              roleSlotId: 'pragmatist',
            }),
          }),
        ],
      }),
      expect.objectContaining({
        role: 'tool_result',
        toolCallId: 'architecture:run-streamless:event-pragmatist',
      }),
    ]));
    expect(projection.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        architectureRun: expect.objectContaining({
          runId: 'run-streamless',
          trace: [expect.objectContaining({ nodeId: 'pragmatist', stream: undefined })],
        }),
      }),
    ]));
  });
});

describe('findArchitectureRunInMessages', () => {
  it('reconstructs architecture run metadata from persisted tool calls after reload', () => {
    const metadata = findArchitectureRunInMessages([
      {
        id: 'user-1',
        sessionId: 'parent-session',
        role: 'user',
        content: '[Architecture: Strategic Decision Council]\nWhat can you do?',
        createdAt: 1,
      },
      {
        id: 'assistant-tools',
        sessionId: 'parent-session',
        role: 'assistant',
        content: '',
        createdAt: 2,
        toolCalls: [
          {
            id: 'architecture:run-1:event-pragmatist',
            name: 'run_subagent',
            args: {
              architectureRunId: 'run-1',
              nodeId: 'pragmatist',
              roleSlotId: 'pragmatist',
              childSessionId: 'branch-pragmatist',
            },
          },
        ],
      },
      {
        id: 'tool-pragmatist',
        sessionId: 'parent-session',
        role: 'tool_result',
        content: JSON.stringify({
          result: 'Pragmatist branch answer',
          taskId: 'event-pragmatist',
          childSessionId: 'branch-pragmatist',
          parentSessionId: 'parent-session',
          vfsMode: 'shared',
          vfsSessionId: 'parent-session',
          copiedFiles: [],
          durationMs: 0,
        }),
        toolCallId: 'architecture:run-1:event-pragmatist',
        createdAt: 3,
      },
      {
        id: 'router-text',
        sessionId: 'parent-session',
        role: 'assistant',
        content: '### Router\n\nRouter selected a final path.',
        createdAt: 4,
      },
      {
        id: 'finalizer-text',
        sessionId: 'parent-session',
        role: 'assistant',
        content: '### Finalizer\n\nFinal answer.',
        createdAt: 5,
      },
    ]);

    expect(metadata).toMatchObject({
      runId: 'run-1',
      schemaId: 'Strategic Decision Council',
      status: 'completed',
    });
    expect(metadata?.trace.map((step) => step.speaker)).toEqual(['participant', 'router', 'finalizer']);
    expect(metadata?.trace[0]).toMatchObject({
      content: 'Pragmatist branch answer',
      nodeId: 'pragmatist',
      nextNodeId: 'router',
      stream: {
        branchSessionId: 'branch-pragmatist',
        status: 'completed',
      },
    });
    expect(metadata?.trace[1]).toMatchObject({
      speaker: 'router',
      sessionId: 'arch-run-1-router',
    });
    expect(metadata?.trace[2]).toMatchObject({
      speaker: 'finalizer',
      sessionId: 'arch-run-1-finalizer',
    });
  });

  it('restores sequential router chains in architecture event order after reload', () => {
    const metadata = findArchitectureRunInMessages([
      {
        id: 'user-message',
        sessionId: 'parent-session',
        role: 'user',
        content: '[Architecture: Sequential Router Chain]\nRoute this.',
        createdAt: 1,
      },
      {
        id: 'tool-calls',
        sessionId: 'parent-session',
        role: 'assistant',
        content: '',
        createdAt: 2,
        toolCalls: [
          {
            id: 'architecture:run-seq:run-seq:event:3',
            name: 'run_subagent',
            args: {
              architectureRunId: 'run-seq',
              nodeId: 'pragmatist',
              roleSlotId: 'pragmatist',
              childSessionId: 'branch-pragmatist',
            },
          },
          {
            id: 'architecture:run-seq:run-seq:event:5',
            name: 'run_subagent',
            args: {
              architectureRunId: 'run-seq',
              nodeId: 'innovator',
              roleSlotId: 'innovator',
              childSessionId: 'branch-innovator',
            },
          },
        ],
      },
      {
        id: 'tool-result-pragmatist',
        sessionId: 'parent-session',
        role: 'tool_result',
        content: JSON.stringify({
          result: 'Pragmatist answer',
          taskId: 'run-seq:event:3',
          childSessionId: 'branch-pragmatist',
          parentSessionId: 'parent-session',
          vfsMode: 'shared',
          vfsSessionId: 'parent-session',
          copiedFiles: [],
          durationMs: 0,
        }),
        toolCallId: 'architecture:run-seq:run-seq:event:3',
        createdAt: 3,
      },
      {
        id: 'tool-result-innovator',
        sessionId: 'parent-session',
        role: 'tool_result',
        content: JSON.stringify({
          result: 'Innovator answer',
          taskId: 'run-seq:event:5',
          childSessionId: 'branch-innovator',
          parentSessionId: 'parent-session',
          vfsMode: 'shared',
          vfsSessionId: 'parent-session',
          copiedFiles: [],
          durationMs: 0,
        }),
        toolCallId: 'architecture:run-seq:run-seq:event:5',
        createdAt: 4,
      },
      {
        id: 'architecture:run-seq:text:run-seq:event:2',
        sessionId: 'parent-session',
        role: 'assistant',
        content: '### Router\n\nRoute: router -> pragmatist\n\nRouter entry.',
        createdAt: 5,
      },
      {
        id: 'architecture:run-seq:text:run-seq:event:4',
        sessionId: 'parent-session',
        role: 'assistant',
        content: '### Router\n\nRoute: router -> innovator\n\nRouter check.',
        createdAt: 6,
      },
      {
        id: 'architecture:run-seq:text:run-seq:event:6',
        sessionId: 'parent-session',
        role: 'assistant',
        content: '### Router\n\nRoute: router -> final-artifact\n\nRouter final.',
        createdAt: 7,
      },
      {
        id: 'architecture:run-seq:text:run-seq:event:7',
        sessionId: 'parent-session',
        role: 'assistant',
        content: '### Finalizer\n\nFinal answer.',
        createdAt: 8,
      },
    ]);

    expect(metadata?.trace.map((step) => step.speaker)).toEqual([
      'router',
      'participant',
      'router',
      'participant',
      'router',
      'finalizer',
    ]);
    expect(metadata?.trace.map((step) => step.nodeId)).toEqual([
      'router',
      'pragmatist',
      'router',
      'innovator',
      'router',
      'final-artifact',
    ]);
  });
});
