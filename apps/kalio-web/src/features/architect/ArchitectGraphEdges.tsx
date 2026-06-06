import { edgeClass, edgeDash, edgeHaloClass, edgeWidth, type EdgeKind } from './ArchitectGraphCanvas.model';
import { GraphSvgLayer } from '../graph/GraphSvgLayer';

export type ArchitectGraphRenderedEdge = {
  id: string;
  path: string;
  kind: EdgeKind;
  executed: boolean;
};

export function ArchitectGraphEdges({ edges, markerId }: { edges: ArchitectGraphRenderedEdge[]; markerId: string }) {
  return (
    <GraphSvgLayer>
      <defs>
        <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" className="fill-sky-400/70" />
        </marker>
      </defs>
      {edges.map((edge) => (
        <g key={edge.id}>
          <path
            d={edge.path}
            fill="none"
            className={edgeHaloClass(edge.kind, edge.executed)}
            strokeWidth={edge.executed ? '7' : '5'}
          />
          <path
            d={edge.path}
            fill="none"
            className={edgeClass(edge.kind, edge.executed)}
            markerEnd={`url(#${markerId})`}
            strokeDasharray={edgeDash(edge.kind)}
            strokeWidth={edgeWidth(edge.kind, edge.executed)}
            data-testid={`architect-edge-${edge.id}`}
            data-edge-kind={edge.kind}
          />
        </g>
      ))}
    </GraphSvgLayer>
  );
}
