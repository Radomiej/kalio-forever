import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectInspector } from './ArchitectInspector';
import type { ArchitectNode, ArchitectPersona, ArchitectSchema, ArchitectSlot, PersonaOverrideMap } from './architect.types';
import type { ArchitectureRoleSlot, ArchitectureSchemaEdgeSelection } from '@kalio/types';

describe('ArchitectInspector', () => {
  it('shows the selected persona model and updates the context policy controls for a slot node', async () => {
    const user = userEvent.setup();
    render(<InspectorHarness />);

    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    expect(screen.getByLabelText('Persona prompt: Build the plan.')).toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('architect-persona-select'), 'persona-alt');
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByLabelText('Persona prompt: Challenge financial assumptions.')).toBeInTheDocument();

    await user.click(screen.getByTestId('architect-node-properties-open'));
    await user.click(screen.getByTestId('architect-context-include-outputs'));
    expect(screen.getByTestId('architect-context-include-outputs')).not.toBeChecked();
  });

  it('keeps advanced node controls in the properties modal', async () => {
    const user = userEvent.setup();
    render(<InspectorHarness />);

    expect(screen.getByTestId('architect-persona-select')).toHaveValue('dev');
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    expect(screen.getByLabelText('Persona prompt: Build the plan.')).toBeInTheDocument();
    expect(screen.getByTestId('architect-node-properties-summary')).toHaveTextContent('Role · Run all outgoing');
    expect(screen.queryByTestId('architect-context-include-outputs')).toBeNull();
    expect(screen.queryByTestId('architect-node-kind-select')).toBeNull();

    await user.click(screen.getByTestId('architect-node-properties-open'));

    expect(screen.getByTestId('architect-node-properties-modal')).toBeInTheDocument();
    expect(screen.getByTestId('architect-node-kind-select')).toHaveValue('role');
    expect(screen.getByTestId('architect-context-include-outputs')).toBeChecked();
    expect(screen.getByTestId('architect-context-browser-session')).not.toBeChecked();
    expect(screen.getByTestId('architect-context-prior-decisions')).not.toBeChecked();
  });

  it('closes the node properties modal without changing inspector state', async () => {
    const user = userEvent.setup();
    render(<InspectorHarness />);

    await user.click(screen.getByTestId('architect-node-properties-open'));
    await user.click(screen.getByTestId('architect-node-properties-close'));

    expect(screen.queryByTestId('architect-node-properties-modal')).toBeNull();
    expect(screen.getByTestId('architect-persona-select')).toHaveValue('dev');
  });

  it('emits node tool loop overrides from the properties modal', async () => {
    const user = userEvent.setup();
    const onNodeMaxToolAttemptsOverride = vi.fn();
    render(<InspectorHarness onNodeMaxToolAttemptsOverride={onNodeMaxToolAttemptsOverride} />);

    await user.click(screen.getByTestId('architect-node-properties-open'));

    fireEvent.change(screen.getByTestId('architect-node-max-tool-attempts'), { target: { value: '1000' } });
    expect(onNodeMaxToolAttemptsOverride).toHaveBeenLastCalledWith('pragmatist', 100);

    fireEvent.change(screen.getByTestId('architect-node-max-tool-attempts'), { target: { value: '' } });
    expect(onNodeMaxToolAttemptsOverride).toHaveBeenLastCalledWith('pragmatist', undefined);
  });

  it('emits explicit node tool permission overrides from the properties modal', async () => {
    const user = userEvent.setup();
    const onNodeToolOverride = vi.fn();
    render(<InspectorHarness onNodeToolOverride={onNodeToolOverride} />);

    await user.click(screen.getByTestId('architect-node-properties-open'));

    fireEvent.change(screen.getByTestId('architect-node-tool-override'), { target: { value: 'run_subagent, fs_read fs_list' } });
    expect(onNodeToolOverride).toHaveBeenLastCalledWith('pragmatist', {
      allowedToolNames: ['run_subagent', 'fs_read', 'fs_list'],
    });

    fireEvent.change(screen.getByTestId('architect-node-tool-override'), { target: { value: '' } });
    expect(onNodeToolOverride).toHaveBeenLastCalledWith('pragmatist', undefined);
  });

  it('edits outgoing edge selection metadata instead of node convergence behavior', async () => {
    const user = userEvent.setup();
    const onEdgeSelectionOverride = vi.fn();
    render(<InspectorHarness onEdgeSelectionOverride={onEdgeSelectionOverride} />);

    await user.click(screen.getByTestId('architect-node-properties-open'));
    await user.selectOptions(screen.getByTestId('architect-edge-selection-pragmatist-review'), 'converge');

    expect(onEdgeSelectionOverride).toHaveBeenLastCalledWith('pragmatist', 'review', 'converge', 'pragmatist-review');
    expect(screen.queryByTestId('architect-node-converge-target')).toBeNull();
  });

  it('edits Jev confidence and instructions for auto-routing nodes', async () => {
    const user = userEvent.setup();
    const onAutoRoutingOverride = vi.fn();
    render(<InspectorHarness
      node={{ ...baseNode, kind: 'auto_router', autoRouting: { confidenceThreshold: 0.75, instructions: 'Prefer the agent.' } }}
      onAutoRoutingOverride={onAutoRoutingOverride}
    />);

    await user.click(screen.getByTestId('architect-node-properties-open'));
    expect(screen.getByTestId('architect-auto-routing-confidence')).toHaveValue(0.75);
    expect(screen.getByTestId('architect-auto-routing-instructions')).toHaveValue('Prefer the agent.');

    fireEvent.change(screen.getByTestId('architect-auto-routing-confidence'), { target: { value: '0.88' } });
    expect(onAutoRoutingOverride).toHaveBeenLastCalledWith('pragmatist', {
      confidenceThreshold: 0.88,
      instructions: 'Prefer the agent.',
    });
    fireEvent.change(screen.getByTestId('architect-auto-routing-instructions'), { target: { value: 'Use the default when uncertain.' } });
    expect(onAutoRoutingOverride).toHaveBeenLastCalledWith('pragmatist', {
      confidenceThreshold: 0.75,
      instructions: 'Use the default when uncertain.',
    });
  });

  it('requires Auto-routing edges to have a role and edits the Jev choice label', async () => {
    const user = userEvent.setup();
    const onEdgeLabelOverride = vi.fn();
    const schema: ArchitectSchema = {
      ...baseSchema,
      nodes: baseSchema.nodes.map((candidate) => candidate.id === 'pragmatist' ? { ...candidate, kind: 'auto_router' } : candidate),
      edges: [{ id: 'choice-edge', fromNodeId: 'pragmatist', toNodeId: 'review', selection: 'choice' }],
    };
    render(<InspectorHarness
      node={{ ...baseNode, kind: 'auto_router', autoRouting: { confidenceThreshold: 0.8, instructions: '' } }}
      schema={schema}
      onEdgeLabelOverride={onEdgeLabelOverride}
    />);

    await user.click(screen.getByTestId('architect-node-properties-open'));

    expect(screen.queryByRole('option', { name: 'Normal transition' })).toBeNull();
    await user.type(screen.getByTestId('architect-edge-label-choice-edge'), 'Choose implementation');
    expect(onEdgeLabelOverride).toHaveBeenLastCalledWith('choice-edge', 'Choose implementation');
  });

  it('collapses the inspector to a narrow restore control', () => {
    const onCollapsedChange = vi.fn();
    render(<InspectorHarness collapsed onCollapsedChange={onCollapsedChange} />);

    expect(screen.getByTestId('architect-inspector')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByTestId('architect-persona-select')).toBeNull();

    screen.getByTestId('architect-inspector-expand').click();

    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it('exposes a collapse action when the parent owns inspector visibility', () => {
    const onCollapsedChange = vi.fn();
    render(<InspectorHarness onCollapsedChange={onCollapsedChange} />);

    screen.getByTestId('architect-inspector-collapse').click();

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });
});

function InspectorHarness({
  collapsed = false,
  onCollapsedChange,
  node = baseNode,
  onNodeMaxToolAttemptsOverride = vi.fn(),
  onNodeToolOverride = vi.fn(),
  onAutoRoutingOverride = vi.fn(),
  onEdgeSelectionOverride = vi.fn(),
  onEdgeLabelOverride = vi.fn(),
  schema: initialSchema = baseSchema,
}: {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  node?: ArchitectNode;
  onNodeMaxToolAttemptsOverride?: (nodeId: string, maxToolAttempts?: number) => void;
  onNodeToolOverride?: (nodeId: string, toolOverride?: NonNullable<ArchitectNode['toolOverride']>) => void;
  onAutoRoutingOverride?: (nodeId: string, autoRouting: NonNullable<ArchitectNode['autoRouting']>) => void;
  onEdgeSelectionOverride?: (fromNodeId: string, toNodeId: string, selection?: ArchitectureSchemaEdgeSelection, edgeId?: string) => void;
  onEdgeLabelOverride?: (edgeId: string, label: string) => void;
  schema?: ArchitectSchema;
}) {
  const [nodeState, setNodeState] = useState<ArchitectNode>(node);
  const [personaOverrides, setPersonaOverrides] = useState<PersonaOverrideMap>({});
  const [schema, setSchema] = useState<ArchitectSchema>(initialSchema);

  return (
    <ArchitectInspector
      node={nodeState}
      slot={baseSlot}
      schema={schema}
      personas={personas}
      personaOverrides={personaOverrides}
      nodeKindOverrides={{}}
      collapsed={collapsed}
      onPersonaOverride={(nodeId, personaId) => {
        setPersonaOverrides((current) => {
          const next = { ...current };
          if (personaId) {
            next[nodeId] = personaId;
          } else {
            delete next[nodeId];
          }
          return next;
        });
      }}
      onNodeKindOverride={vi.fn()}
      onNodeBehaviorOverride={vi.fn()}
      onAutoRoutingOverride={onAutoRoutingOverride}
      onNodeMaxToolAttemptsOverride={(nodeId, maxToolAttempts) => {
        setNodeState((current) => (
          current.id === nodeId
            ? { ...current, maxToolAttempts }
            : current
        ));
        onNodeMaxToolAttemptsOverride(nodeId, maxToolAttempts);
      }}
      onNodeToolOverride={(nodeId, toolOverride) => {
        setNodeState((current) => (
          current.id === nodeId
            ? { ...current, toolOverride }
            : current
        ));
        onNodeToolOverride(nodeId, toolOverride);
      }}
      onEdgeSelectionOverride={(fromNodeId, toNodeId, selection, edgeId) => {
        setSchema((current) => ({
          ...current,
          edges: current.edges.map((edge) => (
            (edgeId ? edge.id === edgeId : edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId)
              ? { ...edge, selection }
              : edge
          )),
        }));
        onEdgeSelectionOverride(fromNodeId, toNodeId, selection, edgeId);
      }}
      onEdgeLabelOverride={(edgeId, label) => {
        setSchema((current) => ({
          ...current,
          edges: current.edges.map((edge) => edge.id === edgeId ? { ...edge, label } : edge),
        }));
        onEdgeLabelOverride(edgeId, label);
      }}
      onCollapsedChange={onCollapsedChange}
      onContextPolicyOverride={(slotId, override) => {
        setSchema((current) => ({
          ...current,
          contextPolicy: {
            ...current.contextPolicy,
            perSlotOverrides: {
              ...(current.contextPolicy.perSlotOverrides ?? {}),
              [slotId]: override,
            },
          },
        }));
      }}
    />
  );
}

const personas: ArchitectPersona[] = [
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

const baseSlot: ArchitectSlot = {
  id: 'pragmatist',
  label: 'Pragmatist',
  slotType: 'participant',
  description: 'Optimizes for delivery.',
  defaultPersonaId: 'dev',
};

const baseRoleSlot: ArchitectureRoleSlot = {
  id: 'pragmatist',
  label: 'Pragmatist',
  description: 'Optimizes for delivery.',
  slotType: 'participant',
  defaultPersonaId: 'dev',
  allowedPersonaTags: [],
  required: true,
  canOverrideAtRunStart: true,
};

const baseNode: ArchitectNode = {
  id: 'pragmatist',
  label: 'Pragmatist',
  kind: 'role',
  roleSlotId: 'pragmatist',
  personaId: 'dev',
  x: 120,
  y: 120,
  slots: [baseSlot],
  connections: [],
};

const baseSchema: ArchitectSchema = {
  id: 'strategic-decision-council',
  name: 'Strategic Decision Council',
  description: '',
  version: '1.0.0',
  roleSlots: [baseRoleSlot],
  nodes: [
    baseNode,
    {
      id: 'review',
      label: 'Review',
      kind: 'router',
      x: 320,
      y: 120,
      slots: [],
      connections: [],
    },
  ],
  edges: [{ id: 'pragmatist-review', fromNodeId: 'pragmatist', toNodeId: 'review' }],
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
    perSlotOverrides: {},
  },
  memoryPolicy: {
    persistFinalArtifact: false,
    persistRouterDecision: false,
  },
  outputArtifactSchema: 'Artifact',
};
