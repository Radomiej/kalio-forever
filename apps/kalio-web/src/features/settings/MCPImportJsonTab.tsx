import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { CreateMCPServerDto } from '@kalio/types';
import { parseMcpJson, type ParsedMCPEntry } from './parseMcpJson';

interface Props {
  onSubmit: (dto: CreateMCPServerDto) => Promise<void>;
  onCancel: () => void;
}

const PLACEHOLDER = `{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless"]
    }
  }
}`;

export function MCPImportJsonTab({ onSubmit, onCancel }: Props) {
  const [rawJson, setRawJson] = useState('');
  const [entries, setEntries] = useState<ParsedMCPEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [parsed, setParsed] = useState(false);

  const handleParse = () => {
    setParseError(null);
    setEntries([]);
    setSelected(new Set());
    setSubmitErrors({});
    setParsed(false);
    try {
      const result = parseMcpJson(rawJson);
      if (result.length === 0) {
        setParseError('No valid server entries found in the JSON.');
        return;
      }
      setEntries(result);
      setSelected(new Set(result.map((e) => e.key)));
      setParsed(true);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Parse failed.');
    }
  };

  const toggleEntry = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.key)));
    }
  };

  const handleConnect = async () => {
    const toConnect = entries.filter((e) => selected.has(e.key));
    if (toConnect.length === 0) return;

    setSubmitting(true);
    setSubmitErrors({});

    let anySuccess = false;
    const errors: Record<string, string> = {};

    for (const entry of toConnect) {
      try {
        await onSubmit(entry.dto);
        anySuccess = true;
      } catch (err) {
        errors[entry.key] = err instanceof Error ? err.message : 'Failed to connect';
      }
    }

    setSubmitting(false);

    if (Object.keys(errors).length > 0) {
      setSubmitErrors(errors);
    }

    // Close the form only if all selected servers connected without errors
    if (anySuccess && Object.keys(errors).length === 0) {
      onCancel();
    }
  };

  const allSelected = entries.length > 0 && selected.size === entries.length;

  return (
    <div className="flex flex-col gap-3">
      {/* JSON textarea */}
      <label className="form-control gap-1">
        <span className="text-xs text-base-content/60">Paste VS Code or Claude Desktop MCP JSON</span>
        <textarea
          className="textarea textarea-bordered textarea-sm font-mono text-xs leading-relaxed"
          rows={7}
          placeholder={PLACEHOLDER}
          value={rawJson}
          onChange={(e) => {
            setRawJson(e.target.value);
            if (parsed) {
              // Reset parsed state when user edits the JSON
              setParsed(false);
              setEntries([]);
              setSelected(new Set());
              setSubmitErrors({});
            }
          }}
          data-testid="mcp-import-json-textarea"
        />
      </label>

      {parseError && (
        <p className="text-xs text-error" data-testid="mcp-import-parse-error">{parseError}</p>
      )}

      {!parsed && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleParse}
          disabled={!rawJson.trim()}
          data-testid="mcp-import-parse-btn"
        >
          Parse JSON
        </button>
      )}

      {/* Parsed entries list */}
      {parsed && entries.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="mcp-import-entries">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">
              {entries.length} server{entries.length !== 1 ? 's' : ''} found
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={toggleAll}
              data-testid="mcp-import-toggle-all"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {entries.map((entry) => (
              <label
                key={entry.key}
                className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-base-300/40"
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={selected.has(entry.key)}
                  onChange={() => toggleEntry(entry.key)}
                  data-testid={`mcp-import-check-${entry.key}`}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm truncate block">{entry.dto.name}</span>
                  <span className="text-xs text-base-content/50 font-mono">{entry.dto.transport}</span>
                </div>
                {submitErrors[entry.key] && (
                  <span className="text-xs text-error shrink-0">{submitErrors[entry.key]}</span>
                )}
              </label>
            ))}
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1"
              onClick={() => void handleConnect()}
              disabled={submitting || selected.size === 0}
              data-testid="mcp-import-connect-btn"
            >
              {submitting && <Loader2 size={13} className="animate-spin" />}
              Connect {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </div>
      )}

      {/* Cancel when nothing parsed yet */}
      {!parsed && (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
