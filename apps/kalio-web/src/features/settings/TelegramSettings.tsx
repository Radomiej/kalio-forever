import { useEffect, useState } from 'react';

interface TelegramStatus {
  connected: boolean;
  botUsername?: string;
  chatIdRegistered: boolean;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const method = opts?.method?.toUpperCase() ?? 'GET';
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    cache: method === 'GET' ? 'no-store' : undefined,
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function TelegramSettings() {
  const [status, setStatus] = useState<TelegramStatus>({ connected: false, chatIdRegistered: false });
  const [botToken, setBotToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<TelegramStatus>('/relay/telegram/status')
      .then(setStatus)
      .catch((err: unknown) => {
        console.error('[TelegramSettings] Failed to fetch status', err instanceof Error ? err : new Error(String(err)));
      });
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ botUsername: string }>('/relay/telegram/connect', {
        method: 'POST',
        body: JSON.stringify({ botToken }),
      });
      setStatus({ connected: true, botUsername: result.botUsername, chatIdRegistered: false });
      setBotToken('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch<void>('/relay/telegram/connect', { method: 'DELETE' });
      setStatus({ connected: false, chatIdRegistered: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="text-base font-semibold mb-1">Telegram Notifications</h2>
        <p className="text-sm text-base-content/60">
          Connect a Telegram bot to receive escalation alerts and control agent sessions remotely.
          Only your bot token is needed — register your chat ID directly in Telegram.
        </p>
      </div>

      {/* Status badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`badge badge-sm ${status.connected ? 'badge-success' : 'badge-ghost'}`}>
          {status.connected ? `Bot: @${status.botUsername ?? '...'}` : 'Bot: disconnected'}
        </span>
        {status.connected && (
          <span className={`badge badge-sm ${status.chatIdRegistered ? 'badge-success' : 'badge-warning'}`}>
            {status.chatIdRegistered ? 'Chat: registered' : 'Chat: not registered'}
          </span>
        )}
      </div>

      {error && (
        <div className="alert alert-error text-sm py-2">
          <span>{error}</span>
        </div>
      )}

      {status.connected ? (
        <div className="flex flex-col gap-4">
          {!status.chatIdRegistered && (
            <div className="alert alert-warning text-sm py-2">
              <span>
                Open Telegram, find your bot <strong>@{status.botUsername}</strong>, and send{' '}
                <code>/register</code> to link this chat and start receiving notifications.
              </span>
            </div>
          )}
          <button
            className="btn btn-error btn-sm w-fit"
            disabled={loading}
            onClick={() => {
              handleDisconnect().catch((err: unknown) => {
                console.error('[TelegramSettings] disconnect error', err instanceof Error ? err : new Error(String(err)));
              });
            }}
          >
            {loading ? 'Disconnecting…' : 'Disconnect bot'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-w-sm">
          <label className="form-control">
            <div className="label">
              <span className="label-text text-xs">Bot Token</span>
            </div>
            <input
              type="password"
              className="input input-bordered input-sm"
              placeholder="123456:ABC-DEF1234..."
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
            />
            <div className="label">
              <span className="label-text-alt text-xs text-base-content/50">
                Create a bot via{' '}
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="link">
                  @BotFather
                </a>{' '}
                and paste the token here. After connecting, send <code>/register</code> to your bot
                in Telegram to link your chat.
              </span>
            </div>
          </label>
          <button
            className="btn btn-primary btn-sm w-fit"
            disabled={loading || !botToken}
            onClick={() => {
              handleConnect().catch((err: unknown) => {
                console.error('[TelegramSettings] connect error', err instanceof Error ? err : new Error(String(err)));
              });
            }}
          >
            {loading ? 'Connecting…' : 'Connect bot'}
          </button>
        </div>
      )}

      {status.connected && (
        <div className="text-sm text-base-content/60 space-y-1">
          <p className="font-medium text-base-content/80">Available commands in Telegram:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li><code>/register</code> — link this chat to receive notifications</li>
            <li><code>/status</code> — show active sessions</li>
            <li><code>/stop</code> — stop all running sessions</li>
            <li><code>/help</code> — list all commands</li>
          </ul>
        </div>
      )}
    </div>
  );
}


async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const method = opts?.method?.toUpperCase() ?? 'GET';
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    cache: method === 'GET' ? 'no-store' : undefined,
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function TelegramSettings() {
  const [status, setStatus] = useState<TelegramStatus>({ connected: false });
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<TelegramStatus>('/relay/telegram/status')
      .then(setStatus)
      .catch((err: unknown) => {
        console.error('[TelegramSettings] Failed to fetch status', err instanceof Error ? err : new Error(String(err)));
      });
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ botUsername: string }>('/relay/telegram/connect', {
        method: 'POST',
        body: JSON.stringify({ botToken, chatId }),
      });
      setStatus({ connected: true, botUsername: result.botUsername });
      setBotToken('');
      setChatId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch<void>('/relay/telegram/connect', { method: 'DELETE' });
      setStatus({ connected: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="text-base font-semibold mb-1">Telegram Notifications</h2>
        <p className="text-sm text-base-content/60">
          Connect a Telegram bot to receive escalation alerts and control agent sessions via{' '}
          <code>/stop</code> and <code>/status</code> commands.
        </p>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span
          className={`badge badge-sm ${status.connected ? 'badge-success' : 'badge-ghost'}`}
        >
          {status.connected ? `Connected as @${status.botUsername ?? '...'}` : 'Disconnected'}
        </span>
      </div>

      {error && (
        <div className="alert alert-error text-sm py-2">
          <span>{error}</span>
        </div>
      )}

      {status.connected ? (
        <button
          className="btn btn-error btn-sm w-fit"
          disabled={loading}
          onClick={() => {
            handleDisconnect().catch((err: unknown) => {
              console.error('[TelegramSettings] disconnect error', err instanceof Error ? err : new Error(String(err)));
            });
          }}
        >
          {loading ? 'Disconnecting…' : 'Disconnect'}
        </button>
      ) : (
        <div className="flex flex-col gap-3 max-w-sm">
          <label className="form-control">
            <div className="label">
              <span className="label-text text-xs">Bot Token</span>
            </div>
            <input
              type="password"
              className="input input-bordered input-sm"
              placeholder="123456:ABC-DEF1234..."
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
            />
          </label>
          <label className="form-control">
            <div className="label">
              <span className="label-text text-xs">Your Chat ID</span>
            </div>
            <input
              type="text"
              className="input input-bordered input-sm"
              placeholder="123456789"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
            />
            <div className="label">
              <span className="label-text-alt text-xs text-base-content/50">
                Send any message to your bot and use{' '}
                <a
                  href="https://api.telegram.org/bot{TOKEN}/getUpdates"
                  target="_blank"
                  rel="noreferrer"
                  className="link"
                >
                  getUpdates
                </a>{' '}
                to find your chat ID.
              </span>
            </div>
          </label>
          <button
            className="btn btn-primary btn-sm w-fit"
            disabled={loading || !botToken || !chatId}
            onClick={() => {
              handleConnect().catch((err: unknown) => {
                console.error('[TelegramSettings] connect error', err instanceof Error ? err : new Error(String(err)));
              });
            }}
          >
            {loading ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      )}

      {status.connected && (
        <div className="text-sm text-base-content/60 space-y-1">
          <p className="font-medium text-base-content/80">Available commands:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li><code>/status</code> — show active sessions</li>
            <li><code>/stop</code> — stop all running sessions</li>
            <li><code>/help</code> — list all commands</li>
          </ul>
        </div>
      )}
    </div>
  );
}
