import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { CreateMCPServerDto } from '@kalio/types';
import { MCPImportJsonTab } from './MCPImportJsonTab';

interface Props {
  onSubmit: (dto: CreateMCPServerDto) => Promise<void>;
  onCancel: () => void;
}

function parseArgs(input: string): string[] | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of trimmed) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (/\s/.test(char) && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens.length > 0 ? tokens : undefined;
}

export function MCPAddServerForm({ onSubmit, onCancel }: Props) {
  const [activeTab, setActiveTab] = useState<'manual' | 'json'>('manual');
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'http' | 'stdio'>('http');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [envText, setEnvText] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseKV = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k) out[k] = v;
    }
    return out;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    const trimmedCommand = command.trim();

    if (trimmedName.length === 0) {
      setError('Name is required');
      return;
    }

    if (transport === 'http' && trimmedUrl.length === 0) {
      setError('URL is required');
      return;
    }

    if (transport === 'stdio' && trimmedCommand.length === 0) {
      setError('Command is required');
      return;
    }

    setSubmitting(true);
    try {
      const dto: CreateMCPServerDto = {
        name: trimmedName,
        transport,
        ...(transport === 'http'
          ? {
              url: trimmedUrl,
              headers: headersText.trim() ? parseKV(headersText) : undefined,
            }
          : {
              command: trimmedCommand,
              args: parseArgs(args),
              env: envText.trim() ? parseKV(envText) : undefined,
            }),
      };
      await onSubmit(dto);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add server');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3 p-4 rounded-lg border border-base-300 bg-base-200/40"
      onSubmit={(e) => void handleSubmit(e)}
      data-testid="mcp-add-form"
    >
      <h4 className="text-sm font-semibold">Add MCP Server</h4>

      {/* Mode tabs */}
      <div className="flex gap-2">
        <button
          type="button"
          className={`btn btn-xs flex-1 ${activeTab === 'manual' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
          onClick={() => setActiveTab('manual')}
          data-testid="mcp-tab-manual"
        >
          Manual
        </button>
        <button
          type="button"
          className={`btn btn-xs flex-1 ${activeTab === 'json' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
          onClick={() => setActiveTab('json')}
          data-testid="mcp-tab-json"
        >
          Import JSON
        </button>
      </div>

      {activeTab === 'json' && (
        <MCPImportJsonTab onSubmit={onSubmit} onCancel={onCancel} />
      )}

      {activeTab === 'manual' && <>

      {/* Name */}
      <label className="form-control gap-1">
        <span className="text-xs text-base-content/60">Name</span>
        <input
          className="input input-bordered input-sm"
          placeholder="My MCP Server"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          data-testid="mcp-form-name"
        />
      </label>

      {/* Transport toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          className={`btn btn-xs flex-1 ${transport === 'http' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
          onClick={() => setTransport('http')}
          data-testid="mcp-form-transport-http"
        >
          HTTP
        </button>
        <button
          type="button"
          className={`btn btn-xs flex-1 ${transport === 'stdio' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
          onClick={() => setTransport('stdio')}
          data-testid="mcp-form-transport-stdio"
        >
          stdio
        </button>
      </div>

      {/* HTTP fields */}
      {transport === 'http' && (
        <>
          <label className="form-control gap-1">
            <span className="text-xs text-base-content/60">URL</span>
            <input
              className="input input-bordered input-sm font-mono"
              placeholder="https://mcp.example.com/sse"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              data-testid="mcp-form-url"
            />
          </label>
          <label className="form-control gap-1">
            <span className="text-xs text-base-content/60">Headers (optional, KEY=VALUE per line)</span>
            <textarea
              className="textarea textarea-bordered textarea-sm font-mono text-xs leading-relaxed"
              rows={2}
              placeholder={'Authorization=Bearer sk-...\nX-Custom=value'}
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              data-testid="mcp-form-headers"
            />
          </label>
        </>
      )}

      {/* stdio fields */}
      {transport === 'stdio' && (
        <>
          <label className="form-control gap-1">
            <span className="text-xs text-base-content/60">Command</span>
            <input
              className="input input-bordered input-sm font-mono"
              placeholder="npx"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              required
              data-testid="mcp-form-command"
            />
          </label>
          <label className="form-control gap-1">
            <span className="text-xs text-base-content/60">Args (space-separated)</span>
            <input
              className="input input-bordered input-sm font-mono"
              placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              data-testid="mcp-form-args"
            />
          </label>
          <label className="form-control gap-1">
            <span className="text-xs text-base-content/60">Env vars (optional, KEY=VALUE per line)</span>
            <textarea
              className="textarea textarea-bordered textarea-sm font-mono text-xs leading-relaxed"
              rows={2}
              placeholder={'API_KEY=sk-...\nDEBUG=true'}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              data-testid="mcp-form-env"
            />
          </label>
        </>
      )}

      {error && (
        <p className="text-xs text-error">{error}</p>
      )}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          data-testid="mcp-form-cancel"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm gap-1"
          disabled={submitting}
          data-testid="mcp-form-submit"
        >
          {submitting && <Loader2 size={13} className="animate-spin" />}
          Connect
        </button>
      </div>
      </>}
    </form>
  );
}
