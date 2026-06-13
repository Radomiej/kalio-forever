# Kalio — Quick Start for Users (Windows)

Install Kalio as a local production stack on your machine. No API key required for the first run (mock LLM). Add a real provider later in **Settings**.

## One-line install

```powershell
irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install.ps1 | iex
```

**Requirements:** Windows 10+, Node.js 22+, Git, PowerShell 5+.

The installer will:

1. Clone Kalio to `%LocalAppData%\kalio-forever\app`
2. Store your data in `%LocalAppData%\kalio-forever\` (database, workspaces, memory)
3. Build and start the production stack
4. Register a **Scheduled Task** so Kalio starts automatically after **user sign-in**

## Open Kalio

| | URL |
|---|---|
| UI | http://localhost:6188 |
| API health | http://localhost:4016/api/health |

## First steps

1. Open http://localhost:6188
2. Go to **Settings** and add your LLM provider (or keep `mock` for offline testing)
3. Create a session in **Talk** and send a message
4. Approve tool calls when the HITL prompt appears

## Upgrade

Re-run the installer — it pulls the latest `main` branch, rebuilds, and restarts the stack. Your data in `%LocalAppData%\kalio-forever\` is preserved.

```powershell
irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install.ps1 | iex
```

## Uninstall

Keep your database and workspaces:

```powershell
irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/uninstall.ps1 | iex
```

Remove everything (app + data):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/uninstall.ps1))) -Force
```

Or from an existing install directory:

```powershell
.\scripts\uninstall.ps1 -KeepData
.\scripts\uninstall.ps1 -Force
```

## Troubleshooting

| Problem | What to do |
|---|---|
| Node not found | Install Node 22+ from https://nodejs.org (system install, not Cursor bundled Node) |
| Port 4016/6188 in use | Stop the other process or reinstall with `-BackendPort` / `-FrontendPort` |
| Stack not running after sign-in | Check `Get-ScheduledTask -TaskName Kalio-Forever`; logs in `%LocalAppData%\kalio-forever\app\.kalio-stack\logs\` |
| Provider errors | Open Settings, verify API key and base URL |

## For developers

See [local-dev-guide.md](./local-dev-guide.md) for dev (`pnpm dev`), QA (`pnpm qa`), and contributor workflows.
