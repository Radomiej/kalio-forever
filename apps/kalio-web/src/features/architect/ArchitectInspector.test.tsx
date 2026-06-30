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

    expect(onEdgeSelectionOverride).toHaveBeenLastCalledWith('pragmatist', 'review', 'converge');
    expect(screen.queryByTestId('architect-node-converge-target')).toBeNull();
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
  onNodeMaxToolAttemptsOverride = vi.fn(),
  onNodeToolOverride = vi.fn(),
  onEdgeSelectionOverride = vi.fn(),
}: {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onNodeMaxToolAttemptsOverride?: (nodeId: string, maxToolAttempts?: number) => void;
  onNodeToolOverride?: (nodeId: string, toolOverride?: NonNullable<ArchitectNode['toolOverride']>) => void;
  onEdgeSelectionOverride?: (fromNodeId: string, toNodeId: string, selection?: ArchitectureSchemaEdgeSelection) => void;
}) {
  const [nodeState, setNodeState] = useState<ArchitectNode>(baseNode);
  const [personaOverrides, setPersonaOverrides] = useState<PersonaOverrideMap>({});
  const [schema, setSchema] = useState<ArchitectSchema>(baseSchema);

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
      onEdgeSelectionOverride={(fromNodeId, toNodeId, selection) => {
        setSchema((current) => ({
          ...current,
          edges: current.edges.map((edge) => (
            edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId
              ? { ...edge, selection }
              : edge
          )),
        }));
        onEdgeSelectionOverride(fromNodeId, toNodeId, selection);
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
