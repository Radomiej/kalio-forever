import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArchitectPage } from './ArchitectPage';
import { useSessionStore } from '../../store/sessionStore';

const { apiGet, apiPost, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: apiGet,
    post: apiPost,
    delete: apiDelete,
  },
}));

const strategicCouncilSchema = {
  id: 'strategic-decision-council',
  name: 'Strategic Decision Council',
  description: 'Five expert slots produce a decision recommendation.',
  roleSlots: [
    {
      id: 'pragmatist',
      label: 'Pragmatist',
      description: 'Optimizes for delivery.',
      slotType: 'participant',
      defaultPersonaId: 'dev',
      allowedPersonaTags: ['delivery'],
      required: true,
      canOverrideAtRunStart: true,
    },
    {
      id: 'router',
      label: 'Router',
      description: 'Synthesizes role outputs.',
      slotType: 'router',
      defaultPersonaId: 'orchestrator',
      allowedPersonaTags: ['decision'],
      required: true,
      canOverrideAtRunStart: true,
    },
  ],
  nodes: [
    {
      id: 'parallel-deliberation',
      label: 'Parallel Deliberation',
      kind: 'parallel',
      behavior: { mode: 'fan_out_all', fanOut: 'parallel' },
    },
    {
      id: 'pragmatist',
      label: 'Pragmatist',
      kind: 'role',
      roleSlotId: 'pragmatist',
    },
    {
      id: 'router',
      label: 'Router',
      kind: 'router',
      roleSlotId: 'router',
      behavior: { mode: 'rank_then_merge', fanOut: 'sequential', scoringPolicy: 'risk' },
    },
  ],
  edges: [
    { id: 'parallel-pragmatist', fromNodeId: 'parallel-deliberation', toNodeId: 'pragmatist' },
    { id: 'pragmatist-router', fromNodeId: 'pragmatist', toNodeId: 'router', selection: 'converge' },
  ],
};

const goalGuardSchema = {
  id: 'goal-master-delivery-loop',
  name: 'Goal Guard Delivery Loop',
  description: 'Two-agent implementer and Goal Guard delivery loop.',
  roleSlots: [
    {
      id: 'implementer',
      label: 'Implementer',
      description: 'Builds the requested change.',
      slotType: 'participant',
      defaultPersonaId: 'dev',
      allowedPersonaTags: ['delivery'],
      required: true,
      canOverrideAtRunStart: true,
    },
    {
      id: 'goal-guard',
      label: 'Goal Guard',
      description: 'Checks evidence and routes back when incomplete.',
      slotType: 'judge',
      defaultPersonaId: 'dev',
      allowedPersonaTags: ['qa'],
      required: true,
      canOverrideAtRunStart: true,
    },
  ],
  nodes: [
    { id: 'orchestrator', label: 'Orchestrator', kind: 'router', roleSlotId: 'goal-guard' },
    { id: 'implementer', label: 'Implementer', kind: 'role', roleSlotId: 'implementer' },
    { id: 'goal-guard', label: 'Goal Guard', kind: 'router', roleSlotId: 'goal-guard' },
  ],
  edges: [
    { id: 'orchestrator-implementer', fromNodeId: 'orchestrator', toNodeId: 'implementer' },
    { id: 'implementer-goal-guard', fromNodeId: 'implementer', toNodeId: 'goal-guard' },
    { id: 'goal-guard-implementer', fromNodeId: 'goal-guard', toNodeId: 'implementer' },
  ],
};

const labQuickFixSchema = {
  id: 'lab_quick_fix',
  name: 'Lab: Szybka Naprawa',
  description: 'Agent Lab preset quick_fix imported into the registry.',
  roleSlots: [
    {
      id: 'fixer',
      label: 'Fixer',
      description: 'Fixes a narrow bug.',
      slotType: 'participant',
      defaultPersonaId: 'dev',
      allowedPersonaTags: ['delivery'],
      required: true,
      canOverrideAtRunStart: true,
    },
  ],
  nodes: [
    { id: 'fixer', label: 'Fixer', kind: 'role', roleSlotId: 'fixer' },
  ],
  edges: [],
};

const personas = [
  {
    id: 'dev',
    name: 'Fullstack Dev',
    systemPrompt: 'Build the plan.',
    model: 'gpt-4o',
    allowedTools: [],
  },
  {
    id: 'persona-alt',
    name: 'CFO Persona',
    systemPrompt: 'Challenge financial assumptions.',
    model: 'gpt-4o-mini',
    allowedTools: [],
  },
];

const strategicCouncilVariant = {
  ...strategicCouncilSchema,
  id: 'strategic-decision-council-variant-1',
  name: 'Strategic Decision Council Variant',
  version: '0.1.0+variant.1',
  nodes: [
    ...strategicCouncilSchema.nodes.map((node) => (
      node.id === 'pragmatist'
        ? { ...node, kind: 'artifact', x: 320, y: 120 }
        : node
    )),
    { id: 'custom-node-4', label: 'Custom Node 4', kind: 'role', x: 640, y: 220 },
  ],
  roleSlots: strategicCouncilSchema.roleSlots.map((slot) => (
    slot.id === 'pragmatist'
      ? { ...slot, defaultPersonaId: 'persona-alt' }
      : slot
  )),
};

function waitingAgentFlowSnapshot(runId: string, rootSessionId: string, summary = 'Goal Guard is waiting for QA evidence.') {
  return {
    run: {
      id: runId,
      parentSessionId: 'architect-ui',
      childSessionId: rootSessionId,
      openChatSessionId: rootSessionId,
      openGraphRunId: runId,
      flowDefinitionId: 'goal_guard_delivery_loop',
      status: 'waiting_on_orchestrator',
      startMode: 'durable',
      returnMode: 'summary',
      waitingForNodeId: 'goal-guard',
      createdAt: 1770000000000,
      updatedAt: 1770000000000,
    },
    events: [],
    result: {
      flowRunId: runId,
      childSessionId: rootSessionId,
      status: 'waiting_on_orchestrator',
      summary,
      decisions: [],
      nextActions: ['Resume with evidence.'],
      artifacts: [],
      openChatSessionId: rootSessionId,
      openGraphRunId: runId,
    },
  };
}

function mockArchitectureProjectionOnce(runId: string, message: string) {
  apiGet.mockImplementationOnce((url: string) => {
    if (url !== `/api/architecture-runs/${runId}/events`) {
      throw new Error(`unexpected get call: ${url}`);
    }
    return Promise.resolve({
      data: [{
        id: `${runId}-event-1`,
        runId,
        sequence: 1,
        type: 'router_decision',
        message,
        nodeId: 'goal-guard',
        createdAt: 1770000000000,
      }],
    });
  });
  apiGet.mockImplementationOnce((url: string) => {
    if (url !== `/api/architecture-runs/${runId}/graph`) {
      throw new Error(`unexpected get call: ${url}`);
    }
    return Promise.resolve({
      data: {
        runId,
        nodes: [
          { id: 'implementer', label: 'Implementer', kind: 'role', status: 'running', eventIds: [] },
          { id: 'goal-guard', label: 'Goal Guard', kind: 'router', status: 'running', eventIds: [`${runId}-event-1`] },
        ],
        edges: [{ id: 'goal-guard-implementer', fromNodeId: 'goal-guard', toNodeId: 'implementer' }],
        routeHops: [{
          eventId: `${runId}-event-1`,
          source: 'runtime_fallback',
          fromNodeId: 'goal-guard',
          toNodeId: 'implementer',
        }],
      },
    });
  });
  apiGet.mockImplementationOnce((url: string) => {
    if (url !== `/api/architecture-runs/${runId}/chat`) {
      throw new Error(`unexpected get call: ${url}`);
    }
    return Promise.resolve({ data: { runId, messages: [] } });
  });
}

function openGraphControls() {
  fireEvent.click(screen.getByLabelText('More graph controls'));
}

describe('ArchitectPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ sessions: [], activeSessionId: null });
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/architecture-registry/schemas') {
        return Promise.resolve({ data: [strategicCouncilSchema, goalGuardSchema] });
      }

      if (url === '/api/personas') {
        return Promise.resolve({ data: personas });
      }

      if (url === '/api/llm/config') {
        return Promise.resolve({
          data: {
            provider: 'xiaomimimo',
            model: 'mimo-v2.5-pro',
            baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
            contextWindowSize: 32000,
            maxToolAttempts: 8,
            source: 'env',
          },
        });
      }

      if (url === '/api/credentials/active') {
        return Promise.resolve({ data: { credentialId: null } });
      }

      if (url === '/api/sessions') {
        return Promise.resolve({
          data: [{
            id: 'arch-run-1-root',
            title: 'Architecture: Decide the smallest valuable architecture runtime slice.',
            personaId: 'default',
            createdAt: 1770000000000,
            updatedAt: 1770000000000,
          }],
        });
      }

      if (url === '/api/agent-flows/runs?parentSessionId=architect-ui') {
        return Promise.resolve({ data: [] });
      }

      if (url === '/api/architecture-runs/run-1/events') {
        return Promise.resolve({
          data: [{
            id: 'event-1',
            runId: 'run-1',
            sequence: 1,
            type: 'final_artifact',
            message: 'Council completed',
            route: {
              source: 'agent',
              fromNodeId: 'pragmatist',
              selectedNodeIds: ['router'],
              nextNodeId: 'router',
            },
            data: { rootSessionId: 'arch-run-1-root' },
            createdAt: 1770000000000,
          }],
        });
      }

      if (url === '/api/architecture-runs/run-1/graph') {
        return Promise.resolve({
          data: {
            runId: 'run-1',
            nodes: [
              {
                id: 'pragmatist',
                label: 'Pragmatist',
                kind: 'role',
                status: 'completed',
                eventIds: ['event-1'],
              },
              {
                id: 'router',
                label: 'Router',
                kind: 'router',
                status: 'pending',
                eventIds: [],
              },
            ],
            edges: [{ id: 'pragmatist-router', fromNodeId: 'pragmatist', toNodeId: 'router' }],
            routeHops: [{
              eventId: 'event-1',
              source: 'agent',
              fromNodeId: 'pragmatist',
              toNodeId: 'router',
            }],
          },
        });
      }

      if (url === '/api/architecture-runs/run-1/chat') {
        return Promise.resolve({
          data: {
            runId: 'run-1',
            messages: [{
              id: 'message-1',
              eventId: 'event-1',
              speaker: 'finalizer',
              content: 'Recommendation: continue.',
              route: {
                source: 'agent',
                fromNodeId: 'pragmatist',
                selectedNodeIds: ['router'],
                nextNodeId: 'router',
              },
              createdAt: 1770000000000,
            }],
          },
        });
      }

      if (url === '/api/architecture-runs/flow-run-1/events') {
        return Promise.resolve({
          data: [{
            id: 'flow-event-1',
            runId: 'flow-run-1',
            sequence: 1,
            type: 'router_decision',
            message: 'Orchestrator selected Implementer.',
            nodeId: 'orchestrator',
            createdAt: 1770000000000,
          }],
        });
      }

      if (url === '/api/architecture-runs/flow-run-1/graph') {
        return Promise.resolve({
          data: {
            runId: 'flow-run-1',
            nodes: [
              { id: 'implementer', label: 'Implementer', kind: 'role', status: 'completed', eventIds: ['flow-event-1'] },
              { id: 'goal-guard', label: 'Goal Guard', kind: 'router', status: 'pending', eventIds: [] },
            ],
            edges: [{ id: 'implementer-goal-guard', fromNodeId: 'implementer', toNodeId: 'goal-guard' }],
            routeHops: [],
          },
        });
      }

      if (url === '/api/architecture-runs/flow-run-1/chat') {
        return Promise.resolve({
          data: {
            runId: 'flow-run-1',
            messages: [],
          },
        });
      }

      throw new Error(`unexpected get call: ${url}`);
    });
    apiPost.mockResolvedValue({
      data: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide the smallest valuable architecture runtime slice.',
        executionMode: 'subagent_execution',
        status: 'completed',
        rootSessionId: 'arch-run-1-root',
        createdAt: 1770000000000,
        updatedAt: 1770000000000,
        completedAt: 1770000000000,
      },
    });
    apiDelete.mockResolvedValue({ data: undefined });
  });

  it('displays the seeded Strategic Decision Council schema from the registry', async () => {
    render(<ArchitectPage />);

    expect(await screen.findByTestId('architect-schema-strategic-decision-council')).toHaveTextContent('Strategic Decision Council');
    expect(screen.getByTestId('architect-schema-description-strategic-decision-council')).toHaveAttribute(
      'aria-label',
      'Preset description: Five expert slots produce a decision recommendation.',
    );
    expect(screen.getByTestId('architect-node-pragmatist')).toHaveTextContent('Pragmatist');
    expect(screen.getByTestId('architect-node-kind-pragmatist')).toHaveTextContent('role');
    expect(screen.queryByTestId('architect-routing-model')).toBeNull();
    expect(screen.getByTestId('architect-run-audit-toggle')).toHaveTextContent('Run audit');
    expect(screen.getByTestId('architect-node-behavior-router')).toHaveTextContent('rank then merge');
  });

  it('shows inspector details when selecting a node and a slot', async () => {
    render(<ArchitectPage />);

    fireEvent.click(await screen.findByTestId('architect-node-pragmatist'));

    expect(screen.getByTestId('architect-inspector')).toHaveTextContent('Pragmatist');
    expect(screen.getByTestId('architect-inspector')).toHaveTextContent('role');
    expect(screen.getByTestId('architect-node-properties-summary')).toHaveTextContent('Role');
    expect(screen.queryByTestId('architect-node-kind-select')).toBeNull();

    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    expect(screen.getByTestId('architect-node-kind-select')).toHaveValue('role');

    fireEvent.click(screen.getByTestId('architect-node-properties-close'));
    fireEvent.click(screen.getByTestId('architect-slot-pragmatist'));

    expect(screen.getByTestId('architect-inspector')).toHaveTextContent('Pragmatist');
    expect(screen.getByTestId('architect-inspector')).toHaveTextContent('participant');
  });

  it('edits router behavior from the selected node inspector', async () => {
    render(<ArchitectPage />);

    fireEvent.click(await screen.findByTestId('architect-node-router'));
    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    fireEvent.change(screen.getByTestId('architect-node-behavior-mode'), {
      target: { value: 'choose_one' },
    });
    fireEvent.change(screen.getByTestId('architect-node-max-branches'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByTestId('architect-node-scoring-policy'), {
      target: { value: 'cost' },
    });

    expect(screen.getByTestId('architect-node-behavior-router')).toHaveTextContent('choose one');
    fireEvent.click(screen.getByTestId('architect-start-run'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/architecture-runs/async', expect.objectContaining({
        schema: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: 'router',
              behavior: expect.objectContaining({ mode: 'choose_one', maxBranches: 1, scoringPolicy: 'cost' }),
            }),
          ]),
        }),
      }));
    });
  });

  it('starts a run with schema and persona override data', async () => {
    render(<ArchitectPage />);

    fireEvent.click(await screen.findByTestId('architect-node-pragmatist'));
    fireEvent.click(screen.getByTestId('architect-slot-pragmatist'));
    fireEvent.change(screen.getByTestId('architect-persona-select'), {
      target: { value: 'persona-alt' },
    });
    fireEvent.click(screen.getByTestId('architect-start-run'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/architecture-runs/async', {
        schemaId: 'strategic-decision-council',
        prompt: 'Decide the smallest valuable architecture runtime slice.',
        slotOverrides: { pragmatist: 'persona-alt' },
        executionMode: 'subagent_execution',
        context: {
          maxArchitectureSteps: 64,
          maxArchitectureNodeVisits: 4,
          maxArchitectureSubagentIterations: 30,
        },
      });
    });
    expect(await screen.findByText('run-1')).toBeInTheDocument();
    expect(screen.getByText('subagent_execution')).toBeInTheDocument();
    expect(screen.getByText('Council completed')).toBeInTheDocument();
    expect(screen.getByText('pragmatist -> router')).toBeInTheDocument();
    expect(screen.getByText('root arch-run-1-root')).toBeInTheDocument();
    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'arch-run-1-root' }),
      ]));
      expect(useSessionStore.getState().activeSessionId).toBe('arch-run-1-root');
    });

    fireEvent.click(screen.getByTestId('architect-projection-graph'));
    expect(screen.getByTestId('architect-graph-status')).toHaveTextContent('Pragmatist');
    expect(screen.getByTestId('architect-graph-status')).toHaveTextContent('pragmatist');
    expect(screen.getByTestId('architect-graph-status')).toHaveTextContent('router');
    expect(screen.getByTestId('architect-executed-route')).toHaveTextContent('pragmatist -> router');
  });

  it('filters the registry by schema id tokens so Lab presets are discoverable', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/architecture-registry/schemas') {
        return Promise.resolve({ data: [strategicCouncilSchema, goalGuardSchema, labQuickFixSchema] });
      }

      if (url === '/api/personas') {
        return Promise.resolve({ data: personas });
      }

      if (url === '/api/llm/config') {
        return Promise.resolve({ data: { provider: 'xiaomimimo', model: 'mimo-v2.5-pro', source: 'env' } });
      }

      if (url === '/api/credentials/active') {
        return Promise.resolve({ data: { credentialId: null } });
      }

      throw new Error(`unexpected get call: ${url}`);
    });

    render(<ArchitectPage />);

    fireEvent.change(await screen.findByTestId('architect-registry-search'), {
      target: { value: 'lab quick' },
    });

    expect(screen.getByTestId('architect-registry-count')).toHaveTextContent('1/3');
    expect(screen.getByTestId('architect-schema-lab_quick_fix')).toHaveTextContent('Lab: Szybka Naprawa');
    expect(screen.queryByTestId('architect-schema-strategic-decision-council')).not.toBeInTheDocument();
  });

  it('warns that real subagent runs use env fallback when no credential is active', async () => {
    render(<ArchitectPage />);

    expect(await screen.findByTestId('architect-provider-warning')).toHaveTextContent(
      'Real subagent runs use xiaomimimo / mimo-v2.5-pro from env fallback; no saved credential is active.',
    );
  });

  it('passes custom loop guard settings into architecture run context', async () => {
    render(<ArchitectPage />);

    fireEvent.change(await screen.findByTestId('architect-max-steps'), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByTestId('architect-max-node-visits'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByTestId('architect-start-run'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/architecture-runs/async', expect.objectContaining({
        context: expect.objectContaining({
          maxArchitectureSteps: 12,
          maxArchitectureNodeVisits: 3,
        }),
        executionMode: 'subagent_execution',
      }));
    });
  });

  it('passes Goal Master loop proof guard into architecture run context when enabled', async () => {
    render(<ArchitectPage />);

    fireEvent.click(await screen.findByTestId('architect-goal-master-loop-proof'));
    fireEvent.click(screen.getByTestId('architect-start-run'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/architecture-runs/async', expect.objectContaining({
        context: expect.objectContaining({
          maxArchitectureSteps: 64,
          maxArchitectureNodeVisits: 4,
          requireGoalMasterLoopProof: true,
        }),
        executionMode: 'subagent_execution',
      }));
    });
  });

  it('passes strict Implementer write proof into architecture run context when enabled', async () => {
    render(<ArchitectPage />);

    fireEvent.click(await screen.findByTestId('architect-implementer-write-proof'));
    fireEvent.click(screen.getByTestId('architect-start-run'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/architecture-runs/async', expect.objectContaining({
        context: expect.objectContaining({
          maxArchitectureSteps: 64,
          maxArchitectureNodeVisits: 4,
          requireImplementerWriteProof: true,
        }),
        executionMode: 'subagent_execution',
      }));
    });
  });

  it('starts the dedicated Goal Guard AgentFlow through the AgentFlow API', async () => {
    apiPost.mockImplementation((url: string) => {
      if (url === '/api/agent-flows/runs') {
        return Promise.resolve({
          data: {
            run: {
              id: 'flow-run-1',
              parentSessionId: 'architect-ui',
              childSessionId: 'arch-flow-run-1-root',
              openChatSessionId: 'arch-flow-run-1-root',
              openGraphRunId: 'flow-run-1',
              flowDefinitionId: 'goal_guard_delivery_loop',
              status: 'done',
              startMode: 'durable',
              returnMode: 'summary',
              createdAt: 1770000000000,
              updatedAt: 1770000000000,
            },
            events: [],
            result: {
              flowRunId: 'flow-run-1',
              childSessionId: 'arch-flow-run-1-root',
              status: 'done',
              summary: 'Goal Guard accepted the result.',
              decisions: [],
              nextActions: [],
              artifacts: [],
              openChatSessionId: 'arch-flow-run-1-root',
              openGraphRunId: 'flow-run-1',
            },
          },
        });
      }
      return Promise.resolve({
        data: {
          id: 'run-1',
          schemaId: 'strategic-decision-council',
          prompt: 'Decide the smallest valuable architecture runtime slice.',
          executionMode: 'subagent_execution',
          status: 'completed',
          rootSessionId: 'arch-run-1-root',
          createdAt: 1770000000000,
          updatedAt: 1770000000000,
          completedAt: 1770000000000,
        },
      });
    });
    render(<ArchitectPage />);

    fireEvent.click(await screen.findByTestId('architect-start-goal-guard-flow'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/agent-flows/runs', expect.objectContaining({
        flowId: 'goal_guard_delivery_loop',
        parentSessionId: 'architect-ui',
        startMode: 'durable',
        returnMode: 'summary',
        maxSteps: 64,
      }));
    });
    expect(apiPost).not.toHaveBeenCalledWith('/api/architecture-runs/async', expect.anything());
    expect(await screen.findByText('flow-run-1')).toBeInTheDocument();
  });

  it('adds parent-session AgentFlow runs to Architect conversation visibility', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/architecture-registry/schemas') return Promise.resolve({ data: [strategicCouncilSchema, goalGuardSchema] });
      if (url === '/api/personas') return Promise.resolve({ data: personas });
      if (url === '/api/llm/config') {
        return Promise.resolve({
          data: {
            provider: 'xiaomimimo',
            model: 'mimo-v2.5-pro',
            baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
            contextWindowSize: 32000,
            maxToolAttempts: 8,
            source: 'env',
          },
        });
      }
      if (url === '/api/credentials/active') return Promise.resolve({ data: { credentialId: null } });
      if (url === '/api/sessions') return Promise.resolve({ data: [] });
      if (url === '/api/agent-flows/runs?parentSessionId=architect-ui') {
        return Promise.resolve({
          data: [{
            run: {
              id: 'flow-visible',
              parentSessionId: 'architect-ui',
              childSessionId: 'arch-flow-visible-root',
              openChatSessionId: 'arch-flow-visible-root',
              openGraphRunId: 'flow-visible',
              flowDefinitionId: 'goal_guard_delivery_loop',
              status: 'waiting_on_orchestrator',
              startMode: 'durable',
              returnMode: 'summary',
              createdAt: 1770000000000,
              updatedAt: 1770000000100,
            },
            events: [],
          }],
        });
      }
      if (url === '/api/architecture-runs/flow-run-1/events') return Promise.resolve({ data: [] });
      if (url === '/api/architecture-runs/flow-run-1/graph') return Promise.resolve({ data: { runId: 'flow-run-1', nodes: [], edges: [], routeHops: [] } });
      if (url === '/api/architecture-runs/flow-run-1/chat') return Promise.resolve({ data: { runId: 'flow-run-1', messages: [] } });
      throw new Error(`unexpected get call: ${url}`);
    });
    apiPost.mockResolvedValue({
      data: {
        run: {
          id: 'flow-run-1',
          parentSessionId: 'architect-ui',
          childSessionId: 'arch-flow-run-1-root',
          openChatSessionId: 'arch-flow-run-1-root',
          openGraphRunId: 'flow-run-1',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'done',
          startMode: 'durable',
          returnMode: 'summary',
          createdAt: 1770000000000,
          updatedAt: 1770000000000,
        },
        events: [],
      },
    });

    render(<ArchitectPage />);
    fireEvent.click(await screen.findByTestId('architect-start-goal-guard-flow'));

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/api/agent-flows/runs?parentSessionId=architect-ui');
      expect(useSessionStore.getState().sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'arch-flow-visible-root',
          kind: 'agent-flow',
          parentSessionId: 'architect-ui',
        }),
      ]));
    });
  });

  it('keeps a paused Goal Guard AgentFlow visibly waiting for resume instead of collapsing it into running or Five Minds wording', async () => {
    render(<ArchitectPage />);

    apiPost.mockImplementationOnce((url: string) => {
      if (url !== '/api/agent-flows/runs') {
        throw new Error(`unexpected post call: ${url}`);
      }

      return Promise.resolve({
        data: {
          run: {
            id: 'flow-run-2',
            parentSessionId: 'architect-ui',
            childSessionId: 'arch-flow-run-2-root',
            openChatSessionId: 'arch-flow-run-2-root',
            openGraphRunId: 'flow-run-2',
            flowDefinitionId: 'goal_guard_delivery_loop',
            status: 'waiting_on_orchestrator',
            startMode: 'durable',
            returnMode: 'summary',
            waitingForNodeId: 'goal-guard',
            createdAt: 1770000000000,
            updatedAt: 1770000000000,
          },
          events: [
            {
              id: 'flow-event-1',
              sequence: 1,
              type: 'flow:resume_input',
              message: 'Goal Guard is waiting for orchestrator evidence.',
              createdAt: 1770000000000,
            },
          ],
          result: {
            flowRunId: 'flow-run-2',
            childSessionId: 'arch-flow-run-2-root',
            status: 'waiting_on_orchestrator',
            summary: 'Goal Guard is waiting for orchestrator evidence.',
            decisions: [],
            nextActions: ['Resume with evidence.'],
            artifacts: [],
            openChatSessionId: 'arch-flow-run-2-root',
            openGraphRunId: 'flow-run-2',
          },
        },
      });
    });
    apiGet.mockImplementationOnce((url: string) => {
      if (url !== '/api/architecture-runs/flow-run-2/events') {
        throw new Error(`unexpected get call: ${url}`);
      }

      return Promise.resolve({
        data: [
          {
            id: 'arch-flow-event-1',
            runId: 'flow-run-2',
            sequence: 1,
            type: 'router_decision',
            message: 'Goal Guard is waiting for more evidence before resuming.',
            createdAt: 1770000000000,
          },
        ],
      });
    });
    apiGet.mockImplementationOnce((url: string) => {
      if (url !== '/api/architecture-runs/flow-run-2/graph') {
        throw new Error(`unexpected get call: ${url}`);
      }

      return Promise.resolve({
        data: {
          runId: 'flow-run-2',
          nodes: [
            {
              id: 'goal-guard',
              label: 'Goal Guard',
              kind: 'router',
              status: 'running',
              eventIds: ['arch-flow-event-1'],
            },
          ],
          edges: [],
          routeHops: [],
        },
      });
    });
    apiGet.mockImplementationOnce((url: string) => {
      if (url !== '/api/architecture-runs/flow-run-2/chat') {
        throw new Error(`unexpected get call: ${url}`);
      }

      return Promise.resolve({
        data: {
          runId: 'flow-run-2',
          messages: [],
        },
      });
    });

    fireEvent.click(await screen.findByTestId('architect-start-goal-guard-flow'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/agent-flows/runs', expect.objectContaining({
        flowId: 'goal_guard_delivery_loop',
        parentSessionId: 'architect-ui',
        startMode: 'durable',
        returnMode: 'summary',
        maxSteps: 64,
      }));
    });

    expect(await screen.findByText('Goal Guard is waiting for orchestrator evidence.')).toBeInTheDocument();
    expect(screen.getByText('waiting_on_orchestrator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resume with QA evidence/i })).toBeInTheDocument();
    expect(screen.queryByText(/Five Minds/i)).not.toBeInTheDocument();
  });

  it('resumes a paused Goal Guard AgentFlow with structured Playwright QA evidence', async () => {
    render(<ArchitectPage />);

    apiPost.mockImplementationOnce((url: string) => {
      if (url !== '/api/agent-flows/runs') {
        throw new Error(`unexpected post call: ${url}`);
      }
      return Promise.resolve({
        data: waitingAgentFlowSnapshot('flow-run-qa', 'arch-flow-run-qa-root'),
      });
    });
    mockArchitectureProjectionOnce('flow-run-qa', 'Goal Guard is waiting for QA evidence.');

    fireEvent.click(await screen.findByTestId('architect-start-goal-guard-flow'));

    const openResume = await screen.findByRole('button', { name: /Resume with QA evidence/i });
    apiPost.mockImplementationOnce((url: string, body: unknown) => {
      if (url !== '/api/agent-flows/runs/flow-run-qa/resume') {
        throw new Error(`unexpected post call: ${url}`);
      }
      expect(body).toMatchObject({
        context: {
          externalQualityGate: {
            source: 'playwright',
            status: 'failed',
            highFindings: 3,
            summary: 'Focus audit still finds offscreen footer links.',
            artifacts: ['C:\\qa\\focus.png'],
          },
        },
        maxSteps: 64,
      });
      return Promise.resolve({
        data: waitingAgentFlowSnapshot('flow-run-qa', 'arch-flow-run-qa-root', 'Playwright QA evidence sent back to Implementer.'),
      });
    });
    mockArchitectureProjectionOnce('flow-run-qa', 'Runtime routed Goal Guard back to Implementer after Playwright QA.');

    fireEvent.click(openResume);
    fireEvent.change(await screen.findByTestId('agentflow-qa-summary'), {
      target: { value: 'Focus audit still finds offscreen footer links.' },
    });
    fireEvent.change(screen.getByTestId('agentflow-qa-high-findings'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByTestId('agentflow-qa-artifact'), {
      target: { value: 'C:\\qa\\focus.png' },
    });
    fireEvent.click(screen.getByTestId('agentflow-resume-with-qa'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/agent-flows/runs/flow-run-qa/resume', expect.any(Object));
    });
    expect(await screen.findByText('Runtime routed Goal Guard back to Implementer after Playwright QA.')).toBeInTheDocument();
  });

  it('shows a visible running projection while an architecture run is pending', async () => {
    let resolveRun: (value: unknown) => void = () => undefined;
    apiPost.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRun = resolve;
    }));
    render(<ArchitectPage />);

    fireEvent.click(await screen.findByTestId('architect-start-run'));

    expect(await screen.findByText('Run in progress')).toBeInTheDocument();
    expect(screen.getByText('Run started. Waiting for branch events and final artifact...')).toBeInTheDocument();

    resolveRun({
      data: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide the smallest valuable architecture runtime slice.',
        executionMode: 'subagent_execution',
        status: 'completed',
        createdAt: 1770000000000,
        updatedAt: 1770000000000,
        completedAt: 1770000000000,
      },
    });
  });

  it('starts a run with selected node context policy overrides in the draft schema', async () => {
    render(<ArchitectPage />);

    fireEvent.click(await screen.findByTestId('architect-node-pragmatist'));
    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    fireEvent.click(screen.getByTestId('architect-context-include-outputs'));
    fireEvent.change(screen.getByTestId('architect-context-compression'), {
      target: { value: 'evidence_only' },
    });
    fireEvent.click(screen.getByTestId('architect-start-run'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/architecture-runs/async', expect.objectContaining({
        schema: expect.objectContaining({
          contextPolicy: expect.objectContaining({
            perSlotOverrides: expect.objectContaining({
              pragmatist: expect.objectContaining({
                includeOtherAgentOutputs: false,
                contextCompression: 'evidence_only',
              }),
            }),
          }),
        }),
      }));
    });
  });

  it('starts a run with unsaved graph draft schema data', async () => {
    render(<ArchitectPage />);

    await screen.findByTestId('architect-node-pragmatist');
    openGraphControls();
    fireEvent.click(screen.getByTestId('architect-mode-add-node'));
    fireEvent.click(screen.getByTestId('architect-graph-canvas'), { clientX: 640, clientY: 220 });
    const customNode = await screen.findByTestId('architect-node-custom-node-4', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('architect-mode-connect'));
    fireEvent.click(customNode);
    fireEvent.click(screen.getByTestId('architect-node-router'));
    fireEvent.click(screen.getByTestId('architect-start-run'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/architecture-runs/async', expect.objectContaining({
        schemaId: 'strategic-decision-council',
        prompt: 'Decide the smallest valuable architecture runtime slice.',
        slotOverrides: {},
        executionMode: 'subagent_execution',
        context: {
          maxArchitectureSteps: 64,
          maxArchitectureNodeVisits: 4,
          maxArchitectureSubagentIterations: 30,
        },
        schema: expect.objectContaining({
          roleSlots: expect.arrayContaining([
            expect.objectContaining({ id: 'custom-node-4', label: 'Custom Node 4', slotType: 'participant' }),
          ]),
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: 'custom-node-4', label: 'Custom Node 4', kind: 'role', roleSlotId: 'custom-node-4', x: 780, y: 268 }),
          ]),
          edges: expect.arrayContaining([
            expect.objectContaining({ id: 'custom-node-4-router', fromNodeId: 'custom-node-4', toNodeId: 'router' }),
          ]),
        }),
      }));
    });
  });

  it('adds router nodes from the graph palette with router defaults', async () => {
    render(<ArchitectPage />);

    await screen.findByTestId('architect-node-pragmatist');
    openGraphControls();
    fireEvent.click(screen.getByTestId('architect-mode-add-router'));
    fireEvent.click(screen.getByTestId('architect-graph-canvas'), { clientX: 660, clientY: 260 });

    const customNode = await screen.findByTestId('architect-node-custom-node-4', undefined, { timeout: 5000 });

    expect(customNode).toHaveTextContent('Router 4');
    expect(screen.getByTestId('architect-node-kind-custom-node-4')).toHaveTextContent('router');
    expect(screen.getByTestId('architect-node-behavior-custom-node-4')).toHaveTextContent('choose one');

    fireEvent.click(screen.getByTestId('architect-start-run'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/architecture-runs/async', expect.objectContaining({
        schema: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: 'custom-node-4',
              label: 'Router 4',
              kind: 'router',
              behavior: expect.objectContaining({ mode: 'choose_one', fanOut: 'sequential' }),
            }),
          ]),
        }),
      }));
    });
  });

  it('saves persona overrides as a versioned schema variant and selects it', async () => {
    apiPost.mockResolvedValueOnce({ data: strategicCouncilVariant });
    render(<ArchitectPage />);

    fireEvent.click(await screen.findByTestId('architect-node-pragmatist'));
    fireEvent.click(screen.getByTestId('architect-slot-pragmatist'));
    fireEvent.change(screen.getByTestId('architect-persona-select'), {
      target: { value: 'persona-alt' },
    });
    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    fireEvent.change(screen.getByTestId('architect-node-kind-select'), {
      target: { value: 'artifact' },
    });
    fireEvent(screen.getByTestId('architect-node-drag-pragmatist'), new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 100,
    }));
    fireEvent(screen.getByTestId('architect-node-drag-pragmatist'), new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 120,
      clientY: 130,
    }));
    fireEvent(screen.getByTestId('architect-node-drag-pragmatist'), new MouseEvent('pointerup', { bubbles: true }));
    openGraphControls();
    fireEvent.click(screen.getByTestId('architect-mode-add-node'));
    fireEvent.click(screen.getByTestId('architect-graph-canvas'), { clientX: 640, clientY: 220 });
    openGraphControls();
    fireEvent.click(screen.getByTestId('architect-mode-connect'));
    fireEvent.click(screen.getByTestId('architect-node-custom-node-4'));
    fireEvent.click(screen.getByTestId('architect-node-router'));

    expect(screen.getByTestId('architect-node-kind-pragmatist')).toHaveTextContent('artifact');
    expect(screen.getByTestId('architect-node-custom-node-4')).toHaveTextContent('Custom Node 4');
    expect(screen.getByTestId('architect-inspector')).toHaveTextContent('Router');
    fireEvent.click(screen.getByTestId('architect-save-variant'));
    fireEvent.change(await screen.findByTestId('architect-variant-name-input'), {
      target: { value: 'Cost-heavy decision council' },
    });
    fireEvent.change(screen.getByTestId('architect-variant-description-input'), {
      target: { value: 'Variant tuned for cost and delivery trade-offs.' },
    });
    fireEvent.click(screen.getByTestId('architect-confirm-save-variant'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/architecture-registry/schemas/strategic-decision-council/variants', expect.objectContaining({
        name: 'Cost-heavy decision council',
        description: 'Variant tuned for cost and delivery trade-offs.',
        roleSlotPersonaOverrides: { pragmatist: 'persona-alt' },
        nodeKindOverrides: { pragmatist: 'artifact' },
        contextPolicy: expect.objectContaining({
          includeUserTask: true,
        }),
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'pragmatist', kind: 'artifact', x: 384, y: 157 }),
          expect.objectContaining({ id: 'custom-node-4', label: 'Custom Node 4', kind: 'role', x: 780, y: 268 }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ id: 'parallel-pragmatist', fromNodeId: 'parallel-deliberation', toNodeId: 'pragmatist' }),
          expect.objectContaining({ id: 'pragmatist-router', fromNodeId: 'pragmatist', toNodeId: 'router' }),
          expect.objectContaining({ id: 'custom-node-4-router', fromNodeId: 'custom-node-4', toNodeId: 'router' }),
        ]),
      }));
    });
    expect(await screen.findByTestId('architect-schema-strategic-decision-council-variant-1')).toHaveTextContent(
      'Strategic Decision Council Variant',
    );
    expect(screen.getByTestId('architect-inspector')).toHaveTextContent('Router');
    fireEvent.click(screen.getByTestId('architect-node-pragmatist'));
    expect(screen.getByTestId('architect-inspector')).toHaveTextContent('persona-alt');
    expect(screen.getByTestId('architect-node-kind-select')).toHaveValue('artifact');
  });

  it('saves auto-layout graph positions as a versioned schema variant', async () => {
    apiPost.mockResolvedValueOnce({ data: strategicCouncilVariant });
    render(<ArchitectPage />);

    await screen.findByTestId('architect-node-pragmatist');
    openGraphControls();
    fireEvent.click(screen.getByTestId('architect-auto-layout'));
    fireEvent.click(screen.getByTestId('architect-save-variant'));
    fireEvent.change(await screen.findByTestId('architect-variant-name-input'), {
      target: { value: 'Auto layout council' },
    });
    fireEvent.click(screen.getByTestId('architect-confirm-save-variant'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/architecture-registry/schemas/strategic-decision-council/variants', expect.objectContaining({
        name: 'Auto layout council',
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'parallel-deliberation', x: 120, y: 120 }),
          expect.objectContaining({ id: 'pragmatist', x: 360, y: 120 }),
          expect.objectContaining({ id: 'router', x: 600, y: 120 }),
        ]),
      }));
    });
  });

  it('does not save a schema variant before a persona override is selected', async () => {
    render(<ArchitectPage />);

    const saveButton = await screen.findByTestId('architect-save-variant');

    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('renders delete action only for variant schemas, not for seeded schemas', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/architecture-registry/schemas') {
        return Promise.resolve({
          data: [strategicCouncilSchema, goalGuardSchema, labQuickFixSchema, strategicCouncilVariant],
        });
      }

      if (url === '/api/personas') {
        return Promise.resolve({ data: personas });
      }

      if (url === '/api/llm/config') {
        return Promise.resolve({ data: { provider: 'xiaomimimo', model: 'mimo-v2.5-pro', source: 'env' } });
      }

      if (url === '/api/credentials/active') {
        return Promise.resolve({ data: { credentialId: null } });
      }

      throw new Error(`unexpected get call: ${url}`);
    });

    render(<ArchitectPage />);

    expect(await screen.findByTestId('architect-schema-strategic-decision-council')).toBeInTheDocument();
    expect(screen.queryByTestId('architect-delete-schema-strategic-decision-council')).not.toBeInTheDocument();
    expect(screen.queryByTestId('architect-delete-schema-goal-master-delivery-loop')).not.toBeInTheDocument();
    expect(screen.queryByTestId('architect-delete-schema-lab_quick_fix')).not.toBeInTheDocument();
    expect(screen.getByTestId('architect-delete-schema-strategic-decision-council-variant-1')).toBeInTheDocument();
  });

  it('deletes a selected variant schema and safely keeps selection on a remaining schema', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/architecture-registry/schemas') {
        return Promise.resolve({ data: [strategicCouncilSchema, strategicCouncilVariant] });
      }

      if (url === '/api/personas') {
        return Promise.resolve({ data: personas });
      }

      if (url === '/api/llm/config') {
        return Promise.resolve({ data: { provider: 'xiaomimimo', model: 'mimo-v2.5-pro', source: 'env' } });
      }

      if (url === '/api/credentials/active') {
        return Promise.resolve({ data: { credentialId: null } });
      }

      throw new Error(`unexpected get call: ${url}`);
    });

    render(<ArchitectPage />);

    fireEvent.click(await screen.findByTestId('architect-schema-strategic-decision-council-variant-1'));
    fireEvent.click(screen.getByTestId('architect-delete-schema-strategic-decision-council-variant-1'));

    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith('/api/architecture-registry/schemas/strategic-decision-council-variant-1');
    });

    await waitFor(() => {
      expect(screen.queryByTestId('architect-schema-strategic-decision-council-variant-1')).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId('architect-schema-strategic-decision-council').closest('div'),
    ).toHaveClass('bg-sky-500/10');
  });
});
