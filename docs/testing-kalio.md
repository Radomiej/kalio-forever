# Test Kalio locally on Windows

This guide separates a source checkout, the built QA stack, and an installed
release. They use different data directories. A passing local check does not
prove that a published installer or another laptop works.

## Recommended: built QA stack

From a PowerShell terminal in the repository:

```powershell
cd E:\Projekty\kalio-forever
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
node -p "process.execPath" # should be C:\Program Files\nodejs\node.exe
corepack pnpm install
corepack pnpm qa
```

Open **http://localhost:5288**. The QA API is at
**http://localhost:3316**. It uses `%LocalAppData%\kalio-forever-qa`, separate
from development and the Windows user installation. If a QA stack is already
running, check it before deciding whether to restart it:

```powershell
corepack pnpm qa:status
Invoke-RestMethod http://localhost:3316/api/health
Invoke-RestMethod http://localhost:3316/api/llm/config
```

Check the effective provider in `/api/llm/config` before interpreting a chat
test. For an offline first run, stop only the QA stack you started and relaunch
with `./start-qa.ps1 -UseMockLLM`. A mock response tests UI/runtime wiring, not
the quality or availability of a real model.

### Manual smoke test

1. Open **Talk**, create a new session, and send a simple message. Confirm a
   reply appears and the session remains in the list.
2. Refresh the page. Reopen the session and confirm the message history and
   final state are restored. If the run has child agents, also inspect its
   Session Panel and Execution Graph.
3. Start another turn, then use **Stop** while it is active. Confirm the UI
   settles and a later follow-up can start. Check queued state if you sent a
   follow-up before the active turn finished.
4. If a tool asks for confirmation, review its target and approve or reject
   deliberately. Never test a destructive action against important files.
5. Open **Settings** to configure your own provider or local CLI credentials.
   Test Codex and Devin separately; their login states are independent. Do not
   copy Codex's config file into Kalio as a substitute for Kalio MCP setup.

Record the QA URL, effective provider, profile/CLI used, and any failing
session ID. A green `/api/health` alone does not prove chat, reconnect, tools,
or a real provider.

When finished, stop only the QA stack you started:

```powershell
corepack pnpm qa:stop
```

## Automated checks before a PR

```powershell
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test:e2e
```

Playwright starts its own isolated stack on random ports; it does not use the
fixed QA ports. These commands validate the checkout, not a published release.
See [local development](local-dev-guide.md) for dev hot reload and other stack
modes.

## Installed Windows release

Once the CMD installer is published on `main` and a compatible runtime archive
is available in GitHub Releases, follow the
[Windows user guide](quickstart-user.md) on the target laptop. The install
command in that guide reads scripts from `main`; an open PR does not publish
them. Open **http://127.0.0.1:4016** and check
**http://127.0.0.1:4016/api/health**. The installed runtime uses
`%LocalAppData%\Kalio\data`, not the repository QA data.

For an installation smoke test, repeat the Talk/reload flow above, sign out
and back into Windows to verify autostart (unless installed with
`-NoAutostart`), and check that the existing data remains after a normal
update. Do not force an update while agents are active. A packaged Tauri/NSIS
desktop build is a separate, optional installation path and requires its own
smoke test.
