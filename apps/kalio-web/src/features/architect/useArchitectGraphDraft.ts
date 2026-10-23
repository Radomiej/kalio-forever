import { useMemo, useState } from 'react';
import type { ArchitectureContextPolicyOverride, ArchitectureNodeKind, ArchitectureSchemaEdgeSelection, ArchitectureSchemaNode } from '@kalio/types';
import type { ArchitectSchema, NodeKindOverrideMap, NodeToolOverrideMap, PersonaOverrideMap } from './architect.types';
import { applyGraphDraft, createDraftNode, EMPTY_GRAPH_DRAFT, setEdgeSelection, toggleEdge, type GraphDraft } from './ArchitectPage.graph';
import { layoutGraphNodes } from './ArchitectGraphLayout';

export function useArchitectGraphDraft(
  selectedSchema: ArchitectSchema | null,
  setSelectedNodeId: (nodeId: string | null) => void,
  setSelectedSlotId: (slotId: string | null) => void,
) {
  const [personaOverrides, setPersonaOverrides] = useState<PersonaOverrideMap>({});
  const [nodeKindOverrides, setNodeKindOverrides] = useState<NodeKindOverrideMap>({});
  const [contextPolicyOverrides, setContextPolicyOverrides] = useState<Record<string, ArchitectureContextPolicyOverride>>({});
  const [graphDraft, setGraphDraft] = useState<GraphDraft>(EMPTY_GRAPH_DRAFT);
  const editableSchema = useMemo(
    () => applyGraphDraft(selectedSchema, nodeKindOverrides, graphDraft, contextPolicyOverrides),
    [contextPolicyOverrides, graphDraft, nodeKindOverrides, selectedSchema],
  );
  const hasVariantChanges = useMemo(
    () => Object.keys(personaOverrides).length > 0
      || Object.keys(nodeKindOverrides).length > 0
      || Object.keys(contextPolicyOverrides).length > 0
      || Object.keys(graphDraft.nodePositions).length > 0
      || Object.keys(graphDraft.nodeBehaviors).length > 0
      || Object.keys(graphDraft.nodeMaxToolAttempts).length > 0
      || Object.keys(graphDraft.nodeToolOverrides).length > 0
      || Object.keys(graphDraft.nodeAutoRouting ?? {}).length > 0
      || graphDraft.addedNodes.length > 0
      || graphDraft.edges !== null,
    [contextPolicyOverrides, graphDraft, nodeKindOverrides, personaOverrides],
  );
  const hasDraftSchemaChanges = useMemo(
    () => Object.keys(nodeKindOverrides).length > 0
      || Object.keys(contextPolicyOverrides).length > 0
      || Object.keys(graphDraft.nodePositions).length > 0
      || Object.keys(graphDraft.nodeBehaviors).length > 0
      || Object.keys(graphDraft.nodeMaxToolAttempts).length > 0
      || Object.keys(graphDraft.nodeToolOverrides).length > 0
      || Object.keys(graphDraft.nodeAutoRouting ?? {}).length > 0
      || graphDraft.addedNodes.length > 0
      || graphDraft.edges !== null,
    [contextPolicyOverrides, graphDraft, nodeKindOverrides],
  );
  const selectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedSlotId(null);
  };

  const setPersonaOverride = (nodeId: string, personaId: string) => {
    setPersonaOverrides((current) => {
      const next = { ...current };
      if (personaId) {
        next[nodeId] = personaId;
      } else {
        delete next[nodeId];
      }
      return next;
    });
  };

  const setNodeKindOverride = (nodeId: string, kind: ArchitectureNodeKind) => {
    const originalKind = selectedSchema?.nodes.find((node) => node.id === nodeId)?.kind;
    setNodeKindOverrides((current) => {
      const next = { ...current };
      if (originalKind === kind) {
        delete next[nodeId];
      } else {
        next[nodeId] = kind;
      }
      return next;
    });
  };

  const setNodeBehaviorOverride = (nodeId: string, behavior: NonNullable<ArchitectureSchemaNode['behavior']>) => {
    const originalBehavior = selectedSchema?.nodes.find((node) => node.id === nodeId)?.behavior;
    setGraphDraft((current) => {
      const nextBehaviors = { ...current.nodeBehaviors };
      if (JSON.stringify(originalBehavior ?? null) === JSON.stringify(behavior)) {
        delete nextBehaviors[nodeId];
      } else {
        nextBehaviors[nodeId] = behavior;
      }
      return { ...current, nodeBehaviors: nextBehaviors };
    });
  };

  const setNodeMaxToolAttemptsOverride = (nodeId: string, maxToolAttempts?: number) => {
    const originalValue = selectedSchema?.nodes.find((node) => node.id === nodeId)?.maxToolAttempts;
    setGraphDraft((current) => {
      const next = { ...current.nodeMaxToolAttempts };
      if ((originalValue ?? undefined) === maxToolAttempts) {
        delete next[nodeId];
      } else {
        next[nodeId] = maxToolAttempts;
      }
      return { ...current, nodeMaxToolAttempts: next };
    });
  };

  const setNodeToolOverride = (nodeId: string, toolOverride?: NodeToolOverrideMap[string]) => {
    const originalValue = selectedSchema?.nodes.find((node) => node.id === nodeId)?.toolOverride;
    setGraphDraft((current) => {
      const next = { ...current.nodeToolOverrides };
      if (JSON.stringify(originalValue ?? null) === JSON.stringify(toolOverride ?? null)) {
        delete next[nodeId];
      } else if (toolOverride) {
        next[nodeId] = toolOverride;
      }
      return { ...current, nodeToolOverrides: next };
    });
  };

  const setContextPolicyOverride = (slotId: string, override: ArchitectureContextPolicyOverride) => {
    setContextPolicyOverrides((current) => {
      const next = { ...current };
      const cleanOverride = Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined));
      if (Object.keys(cleanOverride).length === 0) {
        delete next[slotId];
      } else {
        next[slotId] = cleanOverride;
      }
      return next;
    });
  };

  const moveGraphNode = (nodeId: string, position: { x: number; y: number }) => {
    const roundedPosition = { x: Math.round(position.x), y: Math.round(position.y) };
    const originalNode = selectedSchema?.nodes.find((node) => node.id === nodeId);
    setGraphDraft((current) => {
      if (!originalNode) {
        return {
          ...current,
          addedNodes: current.addedNodes.map((node) => (
            node.id === nodeId ? { ...node, ...roundedPosition } : node
          )),
        };
      }
      const nextPositions = { ...current.nodePositions };
      if (originalNode.x === roundedPosition.x && originalNode.y === roundedPosition.y) {
        delete nextPositions[nodeId];
      } else {
        nextPositions[nodeId] = roundedPosition;
      }
      return { ...current, nodePositions: nextPositions };
    });
  };

  const addGraphNode = (position: { x: number; y: number }, kind: ArchitectureNodeKind = 'role') => {
    if (!editableSchema) {
      return;
    }
    const node = createDraftNode(editableSchema.nodes, position, kind);
    setGraphDraft((current) => ({
      ...current,
      addedNodes: [...current.addedNodes, node],
    }));
    setSelectedNodeId(node.id);
    setSelectedSlotId(null);
  };

  const toggleGraphEdge = (fromNodeId: string, toNodeId: string) => {
    if (!editableSchema || fromNodeId === toNodeId) {
      return;
    }
    setGraphDraft((current) => ({
      ...current,
      edges: toggleEdge(editableSchema, current.edges, fromNodeId, toNodeId),
    }));
    setSelectedNodeId(toNodeId);
    setSelectedSlotId(null);
  };

  const setGraphEdgeSelection = (
    fromNodeId: string,
    toNodeId: string,
    selection?: ArchitectureSchemaEdgeSelection,
  ) => {
    if (!editableSchema || fromNodeId === toNodeId) {
      return;
    }
    setGraphDraft((current) => ({
      ...current,
      edges: setEdgeSelection(editableSchema, current.edges, fromNodeId, toNodeId, selection),
    }));
  };

  const autoLayoutGraph = () => {
    if (!editableSchema) {
      return;
    }
    const layoutNodes = layoutGraphNodes(editableSchema.nodes, editableSchema.edges);
    const nodePositions = Object.fromEntries(layoutNodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    setGraphDraft((current) => ({
      ...current,
      nodePositions,
    }));
  };
  const setAutoRoutingOverride = (nodeId: string, autoRouting: NonNullable<ArchitectureSchemaNode['autoRouting']>) => {
    setGraphDraft((current) => {
      const originalNode = selectedSchema?.nodes.find((node) => node.id === nodeId)
        ?? current.addedNodes.find((node) => node.id === nodeId);
      if (!originalNode) return current;
      const original = originalNode.autoRouting ?? { confidenceThreshold: 0.7, instructions: '' };
      const next = { ...current.nodeAutoRouting };
      if (original.confidenceThreshold === autoRouting.confidenceThreshold && original.instructions === autoRouting.instructions) {
        delete next[nodeId];
      } else {
        next[nodeId] = { ...autoRouting };
      }
      return { ...current, nodeAutoRouting: next };
    });
  };

  return {
    editableSchema, hasVariantChanges, hasDraftSchemaChanges,
    personaOverrides, nodeKindOverrides, contextPolicyOverrides,
    setPersonaOverrides, setPersonaOverride, selectNode,
    setNodeKindOverrides, setContextPolicyOverrides, setGraphDraft,
    setNodeKindOverride, setNodeBehaviorOverride, setAutoRoutingOverride,
    setNodeMaxToolAttemptsOverride, setNodeToolOverride, setContextPolicyOverride,
    moveGraphNode, addGraphNode, toggleGraphEdge, setGraphEdgeSelection, autoLayoutGraph,
  };
}
