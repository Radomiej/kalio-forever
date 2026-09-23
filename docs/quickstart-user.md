# Kalio — Quick Start for Users (Windows)

Install Kalio as a local production stack on your machine. No API key required for the first run (mock LLM). Add a real provider later in **Settings**.

## Install from Windows CMD

Open `cmd.exe` and run:

This command downloads installer scripts from `main` and the latest published
runtime archive. Merging a PR does not update that archive: changes from the PR
reach another computer only after a new runtime release is published.

```cmd
curl.exe -fsSL https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install.cmd -o "%TEMP%\kalio-install.cmd" && call "%TEMP%\kalio-install.cmd" && del "%TEMP%\kalio-install.cmd"
```

Autostart after Windows sign-in is enabled by default. To opt out explicitly:

```cmd
curl.exe -fsSL https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install.cmd -o "%TEMP%\kalio-install.cmd" && call "%TEMP%\kalio-install.cmd" -NoAutostart && del "%TEMP%\kalio-install.cmd"
```

The opt-out is saved under `%LocalAppData%\Kalio\data` and survives a repair.
To enable autostart later, rerun the CMD command with `-EnableAutostart`
instead of `-NoAutostart`.

For the Bun runtime, add `-Runtime bun` after the `call` command. PowerShell is
also available as an alternative:

```powershell
irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install-release.ps1 | iex
```

**Requirements:** Windows 10+, built-in `curl.exe`, and PowerShell 5+. The release archive contains the selected runtime; Git and a separate Node.js installation are not required.

The installer will:

1. Download the selected runtime archive from the latest published GitHub Release
2. Install Kalio to `%LocalAppData%\Kalio\app`
3. Store your data in `%LocalAppData%\Kalio\data` (database, workspaces, memory)
4. Start the production stack with the embedded UI
5. Add a per-user **Startup shortcut** so Kalio starts automatically after **user sign-in**

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

At Windows sign-in the Startup shortcut starts the currently installed version.
User data under `%LocalAppData%\Kalio\data` is preserved.

For an older installation without the built-in updater, re-run the release installer:

```cmd
curl.exe -fsSL https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install.cmd -o "%TEMP%\kalio-install.cmd" && call "%TEMP%\kalio-install.cmd" && del "%TEMP%\kalio-install.cmd"
```

The same built-in `kalio.cmd update` command upgrades a Bun installation; the
release installer remains available as a repair/reinstall path:

```cmd
curl.exe -fsSL https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install.cmd -o "%TEMP%\kalio-install.cmd" && call "%TEMP%\kalio-install.cmd" -Runtime bun && del "%TEMP%\kalio-install.cmd"
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

Remove everything (app + data) without another confirmation prompt:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/uninstall.ps1))) -PurgeData -Force
```

Or from a cloned repository checkout (the installed runtime does not contain
the `scripts` directory):

```powershell
.\scripts\uninstall.ps1
.\scripts\uninstall.ps1 -PurgeData -Force
```

## Troubleshooting

| Problem | What to do |
|---|---|
| Runtime not found | Use the Node archive for the default runtime or the Bun archive; no separate runtime installation is needed |
| Port 4016 in use | Stop the other process or choose another backend port |
| Stack not running after sign-in | Check `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Kalio Forever.lnk`, then run `%LocalAppData%\Kalio\bin\kalio.cmd serve` in CMD to see the startup error |
| Provider errors | Open Settings, verify API key and base URL |

## For developers

See [local-dev-guide.md](./local-dev-guide.md) for dev (`pnpm dev`), QA (`pnpm qa`), and contributor workflows.
