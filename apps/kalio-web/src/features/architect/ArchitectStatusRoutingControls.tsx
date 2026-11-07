import type { ArchitectureSchemaNode } from '@kalio/types';

interface Props {
  nodeId: string;
  nodes: ArchitectureSchemaNode[];
  value?: ArchitectureSchemaNode['statusRouting'];
  onChange?: (nodeId: string, value: NonNullable<ArchitectureSchemaNode['statusRouting']>) => void;
}

export function ArchitectStatusRoutingControls({ nodeId, nodes, value, onChange }: Props) {
  const config = value ?? { sourceNodeId: '', expectedStatus: 'completed' };
  const sources = nodes.filter((node) => node.id !== nodeId && node.kind === 'role' && node.roleSlotId !== undefined);
  return (
    <section className="mt-4 space-y-3 rounded-md border border-base-300/80 bg-base-200/50 p-2.5">
      <label className="form-control gap-1">
        <span className="label-text text-xs">Source node</span>
        <select aria-label="Source node" className="select select-bordered select-sm w-full"
          value={config.sourceNodeId} disabled={!onChange}
          onChange={(event) => onChange?.(nodeId, { ...config, sourceNodeId: event.target.value })}>
          <option value="">Select source node</option>
          {config.sourceNodeId && !sources.some((node) => node.id === config.sourceNodeId) && (
            <option value={config.sourceNodeId}>Missing source: {config.sourceNodeId}</option>
          )}
          {sources.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
        </select>
      </label>
      <label className="form-control gap-1">
        <span className="label-text text-xs">Expected status</span>
        <select aria-label="Expected status" className="select select-bordered select-sm w-full"
          value={config.expectedStatus} disabled={!onChange}
          onChange={(event) => {
            const expectedStatus = event.target.value;
            if (expectedStatus === 'completed' || expectedStatus === 'failed') {
              onChange?.(nodeId, { ...config, expectedStatus });
            }
          }}>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <p className="text-xs text-base-content/65">Check whether the source step completed or failed. Connect one Yes route and one Else route.</p>
    </section>
  );
}
