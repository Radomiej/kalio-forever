type ToolGroup = 'filesystem' | 'web' | 'workflow';

const CLAUDE_NATIVE_TOOL_NAMES = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch',
  'NotebookEdit', 'TodoWrite', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode',
] as const;
type ClaudeNativeToolName = typeof CLAUDE_NATIVE_TOOL_NAMES[number];

const TOOL_DETAILS: Record<ClaudeNativeToolName, { label: string; description: string; group: ToolGroup }> = {
  Read: { label: 'Read', description: 'Read files through Claude Code.', group: 'filesystem' },
  Edit: { label: 'Edit', description: 'Apply edits to files through Claude Code.', group: 'filesystem' },
  Write: { label: 'Write', description: 'Create or overwrite files through Claude Code.', group: 'filesystem' },
  Glob: { label: 'Glob', description: 'Find files by glob pattern.', group: 'filesystem' },
  Grep: { label: 'Grep', description: 'Search file contents.', group: 'filesystem' },
  Bash: { label: 'Bash', description: 'Run shell commands through Claude Code.', group: 'filesystem' },
  WebFetch: { label: 'WebFetch', description: 'Fetch a web page through Claude Code.', group: 'web' },
  WebSearch: { label: 'WebSearch', description: 'Search the web through Claude Code.', group: 'web' },
  NotebookEdit: { label: 'NotebookEdit', description: 'Edit notebook cells through Claude Code.', group: 'filesystem' },
  TodoWrite: { label: 'TodoWrite', description: 'Maintain Claude Code task notes.', group: 'workflow' },
  AskUserQuestion: { label: 'AskUserQuestion', description: 'Ask a structured clarification question.', group: 'workflow' },
  EnterPlanMode: { label: 'EnterPlanMode', description: 'Enter Claude Code planning mode.', group: 'workflow' },
  ExitPlanMode: { label: 'ExitPlanMode', description: 'Request approval to leave planning mode.', group: 'workflow' },
};

interface Props {
  selected: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}

export function ClaudeNativeToolPicker({ selected, onChange, disabled = false }: Props) {
  const selectedSet = new Set(selected);
  const knownSelected = CLAUDE_NATIVE_TOOL_NAMES.filter((name) => selectedSet.has(name));
  const toggle = (name: ClaudeNativeToolName, enabled: boolean) => {
    const next = new Set(knownSelected);
    if (enabled) next.add(name);
    else next.delete(name);
    onChange(CLAUDE_NATIVE_TOOL_NAMES.filter((candidate) => next.has(candidate)));
  };

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3" data-testid="claude-native-tool-picker">
      <legend className="sr-only">Claude Code built-in tools</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-base-content/45">Claude Code built-in tools</p>
          <p className="mt-1 text-xs text-base-content/45">
            Empty means disabled. Enabled tools run inside the Claude SDK and still require Kalio approval when requested.
          </p>
        </div>
        <span className="text-xs font-mono text-base-content/45">{knownSelected.length} / {CLAUDE_NATIVE_TOOL_NAMES.length}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {CLAUDE_NATIVE_TOOL_NAMES.map((name) => {
          const detail = TOOL_DETAILS[name];
          return (
            <label key={name} className="flex cursor-pointer items-start gap-2 rounded-md border border-base-300 bg-base-100/50 p-2 hover:border-primary/40">
              <input
                type="checkbox"
                className="checkbox checkbox-xs checkbox-primary mt-0.5"
                checked={selectedSet.has(name)}
                onChange={(event) => toggle(name, event.target.checked)}
                data-testid={`claude-native-tool-${name}`}
              />
              <span className="min-w-0">
                <span className="block text-xs font-mono font-semibold">{detail.label}</span>
                <span className="block text-[11px] leading-4 text-base-content/50">{detail.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-[11px] leading-4 text-warning/80">
        Claude child/Agent tools and external MCP tools are intentionally not offered here; use Kalio tool policy for those surfaces.
      </p>
    </fieldset>
  );
}
