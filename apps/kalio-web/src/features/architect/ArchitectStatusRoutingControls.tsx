import type { ArchitectureSchemaNode } from '@kalio/types';
import { Info } from 'lucide-react';
import { useId, useState } from 'react';

interface Props {
  nodeId: string;
  nodes: ArchitectureSchemaNode[];
  value?: ArchitectureSchemaNode['statusRouting'];
  onChange?: (nodeId: string, value: NonNullable<ArchitectureSchemaNode['statusRouting']>) => void;
}

export function ArchitectStatusRoutingControls({ nodeId, nodes, value, onChange }: Props) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = useId();
  const statusId = useId();
  const config = value ?? { sourceNodeId: '', expectedStatus: 'completed' };
  const sources = nodes.filter((node) => node.id !== nodeId && node.kind === 'role' && node.roleSlotId !== undefined);
  return (
    <section className="mt-4 space-y-3 rounded-md border border-base-300/80 bg-base-200/50 p-2.5">
      <label className="form-control gap-1">
        <span className="label-text text-xs">Source step</span>
        <select aria-label="Source step" className="select select-bordered select-sm w-full"
          value={config.sourceNodeId} disabled={!onChange}
          onChange={(event) => onChange?.(nodeId, { ...config, sourceNodeId: event.target.value })}>
          <option value="">Select a source step</option>
          {config.sourceNodeId && !sources.some((node) => node.id === config.sourceNodeId) && (
            <option value={config.sourceNodeId}>Missing source: {config.sourceNodeId}</option>
          )}
          {sources.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
        </select>
      </label>
      <div className="form-control gap-1">
        <div className="flex items-center gap-1">
          <label htmlFor={statusId} className="label-text text-xs">When status is</label>
          <button type="button" className="btn btn-ghost btn-xs btn-square" aria-label="About status routing"
            aria-expanded={infoOpen} aria-controls={infoId} onClick={() => setInfoOpen((open) => !open)}>
            <Info size={14} aria-hidden="true" />
          </button>
        </div>
        <select id={statusId} aria-describedby={infoId} className="select select-bordered select-sm w-full"
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
        <p id={infoId} hidden={!infoOpen} className="text-xs text-base-content/65">Branches on step execution status. QA verdicts are evaluated separately. Stop ends the run.</p>
      </div>
      <p className="text-xs text-base-content/65">Connect a Yes route and an Else route.</p>
    </section>
  );
}
