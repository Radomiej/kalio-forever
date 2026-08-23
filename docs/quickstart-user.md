# Kalio — Quick Start for Users (Windows)

Install Kalio as a local production stack on your machine. No API key required for the first run (mock LLM). Add a real provider later in **Settings**.

## One-line install

```powershell
irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install-release.ps1 | iex
```

For the Bun runtime, use:

```powershell
$script = irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install-release.ps1; & ([scriptblock]::Create($script)) -Runtime bun
```

**Requirements:** Windows 10+, PowerShell 5+. The release archive contains the selected runtime; Git and a separate Node.js installation are not required.

The installer will:

1. Download the selected runtime archive from the latest published GitHub Release
2. Install Kalio to `%LocalAppData%\Kalio\app`
3. Store your data in `%LocalAppData%\Kalio\data` (database, workspaces, memory)
4. Start the production stack with the embedded UI
5. Register a **Scheduled Task** so Kalio starts automatically after **user sign-in**

## Open Kalio

| | URL |
|---|---|
| UI | http://127.0.0.1:4016 |
| API health | http://127.0.0.1:4016/api/health |

## First steps

1. Open http://127.0.0.1:4016
2. Go to **Settings** and add your LLM provider (or keep `mock` for offline testing)
3. Create a session in **Talk** and send a message
4. Approve tool calls when the HITL prompt appears

## Upgrade

The Windows install also has a built-in updater. It is a separate process, so it
never tries to overwrite the executable that is currently serving the UI:

```powershell
& "$env:LOCALAPPDATA\Kalio\bin\kalio.cmd" update
```

If Kalio is running, the safe command reports that active work must be saved first.
For an explicit user-requested restart, use `--force`; it targets only the process
tree recorded by this Kalio installation, downloads the published runtime, verifies
the release manifest and SHA-256, switches the version pointer atomically, checks
`/api/runtime/info`, and rolls back the pointer if the new runtime is unhealthy:

```powershell
& "$env:LOCALAPPDATA\Kalio\bin\kalio.cmd" update --force
```

At Windows sign-in the Scheduled Task runs a non-forcing update check before
starting Kalio. A network or signature warning does not prevent the currently
installed version from starting. User data under `%LocalAppData%\Kalio\data` is
preserved.

For an older installation without the built-in updater, re-run the release installer:

```powershell
irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install-release.ps1 | iex
```

The same built-in `kalio.cmd update` command upgrades a Bun installation; the
release installer remains available as a repair/reinstall path:

```powershell
$script = irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install-release.ps1; & ([scriptblock]::Create($script)) -Runtime bun
```

## Linux install and upgrade

Download the installer from the repository and run it locally:

```bash
curl -fsSL https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install-release.sh -o /tmp/kalio-install.sh
bash /tmp/kalio-install.sh --runtime node
```

For Bun, replace `--runtime node` with `--runtime bun`. Re-run the same command to upgrade; the installer preserves the app-local data directory.

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
| Runtime not found | Use the Node archive for the default runtime or the Bun archive; no separate runtime installation is needed |
| Port 4016 in use | Stop the other process or choose another backend port |
| Stack not running after sign-in | Check `Get-ScheduledTask -TaskName Kalio-Forever`; autostart log is `%LocalAppData%\kalio-forever\app\.kalio-stack\logs\autostart.log`, backend/frontend logs are in `%LocalAppData%\kalio-forever\app\.tmp\qa-stack-logs\` |
| Provider errors | Open Settings, verify API key and base URL |

## For developers

See [local-dev-guide.md](./local-dev-guide.md) for dev (`pnpm dev`), QA (`pnpm qa`), and contributor workflows.
