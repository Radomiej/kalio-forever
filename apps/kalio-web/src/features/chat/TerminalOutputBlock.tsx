import { ChevronDown, Terminal, CheckCircle2, XCircle } from 'lucide-react';
import type { CLIAgentResult } from '@kalio/types';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** Maps adapter id → display name */
const AGENT_LABELS: Record<string, string> = {
  copilot: 'GitHub Copilot CLI',
  gemini: 'Google Gemini CLI',
  claude: 'Claude Code',
};

interface Props {
  result: CLIAgentResult;
  isExpanded: boolean;
  onToggle: () => void;
  agentId?: string;
}

export function TerminalOutputBlock({ result, isExpanded, onToggle, agentId }: Props) {
  const { output, exitCode, durationMs } = result;
  const success = exitCode === 0;
  const label = AGENT_LABELS[agentId ?? result.agentId ?? 'copilot'] ?? (agentId ?? 'CLI Agent');

  return (
    <div className="mt-1.5 border border-base-300/40 rounded overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-base-300/30 hover:bg-base-300/50 transition-colors text-left"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label="Toggle CLI agent output"
      >
        <Terminal size={11} className="text-base-content/50 shrink-0" />
        <span className="font-mono text-xs text-base-content/70 flex-1">{label}</span>
        {success ? (
          <CheckCircle2 size={11} className="text-success shrink-0" />
        ) : (
          <XCircle size={11} className="text-error shrink-0" />
        )}
        {!success && (
          <span className="font-mono text-[10px] text-error" title={`exit code ${exitCode}`}>exit={exitCode}</span>
        )}
        <span className="font-mono text-[10px] text-base-content/30">{formatDuration(durationMs)}</span>
        <ChevronDown
          size={11}
          className={`text-base-content/40 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Body */}
      {isExpanded && (
        <div className="bg-zinc-900 px-3 py-2 max-h-72 overflow-y-auto">
          {output ? (
            <pre className="font-mono text-xs text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">
              {output}
            </pre>
          ) : (
            <span className="font-mono text-xs text-zinc-500 italic">(no output)</span>
          )}
        </div>
      )}
    </div>
  );
}
