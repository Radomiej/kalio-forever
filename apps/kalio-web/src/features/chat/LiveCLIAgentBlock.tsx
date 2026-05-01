import { useAgentStore } from '../../store/agentStore';

/** Maps adapter id → display name for the live header */
const AGENT_LABELS: Record<string, string> = {
  copilot: 'GitHub Copilot CLI',
  gemini: 'Google Gemini CLI',
  claude: 'Claude Code',
};

interface Props {
  callId: string;
  agentId?: string;
}

/**
 * Shows a live terminal-style block while a `run_cli_agent` tool call is in-flight.
 * Subscribes to `cliAgentOutput[callId]` in agentStore — chunks arrive via cli_agent:progress.
 */
export function LiveCLIAgentBlock({ callId, agentId = 'copilot' }: Props) {
  const output = useAgentStore((s) => s.cliAgentOutput[callId] ?? '');
  const label = AGENT_LABELS[agentId] ?? agentId;

  return (
    <div className="rounded-lg overflow-hidden border border-base-300 text-sm font-mono">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral text-neutral-content text-xs">
        <span className="loading loading-spinner loading-xs" />
        <span>{label} — running…</span>
      </div>
      {/* Output */}
      <pre className="bg-base-200 text-base-content px-3 py-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed">
        {output || <span className="opacity-40">Waiting for output…</span>}
      </pre>
    </div>
  );
}
