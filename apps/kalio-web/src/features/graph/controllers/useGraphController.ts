import { useCallback } from 'react';
import type { GraphConnectorDragControllerOptions, GraphNodeDragControllerOptions, GraphPanControllerOptions } from './graphController.types';
import { useGraphConnectorDragController } from './useGraphConnectorDragController';
import { useGraphNodeDragController } from './useGraphNodeDragController';
import { useGraphPanController } from './useGraphPanController';

export function useGraphController<
  TNode,
  TConnectorState extends {
    sourceNodeId: string;
    direction?: string;
    moved: boolean;
    pointerId: number;
    startX: number;
    startY: number;
  },
>({
  pan: panOptions,
  nodeDrag: nodeDragOptions,
  connectorDrag: connectorDragOptions,
}: {
  pan: GraphPanControllerOptions;
  nodeDrag: GraphNodeDragControllerOptions<TNode>;
  connectorDrag: GraphConnectorDragControllerOptions<TConnectorState>;
}) {
  const pan = useGraphPanController(panOptions);
  const nodeDrag = useGraphNodeDragController(nodeDragOptions);
  const connectorDrag = useGraphConnectorDragController(connectorDragOptions);

  const resetAll = useCallback(() => {
    pan.resetPan();
    nodeDrag.resetDrag();
    connectorDrag.resetConnector();
  }, [connectorDrag, nodeDrag, pan]);

  return {
    pan,
    nodeDrag,
    connectorDrag,
    resetAll,
  };
}
