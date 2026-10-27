<div align="center">

# Kalio

**Local-first runtime for designing, running, and inspecting agent workflows.**

[![CI](https://github.com/Radomiej/kalio-forever/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Radomiej/kalio-forever/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

[Install on Windows](#install-kalio-on-windows) · [Install on Linux](#install-kalio-on-linux) · [User guide](docs/quickstart-user.md) · [Developer docs](docs/spec/)

</div>

Kalio is a **self-hosted agent architecture runtime**. It combines streaming
chat, tools, memory, files, MCP servers, and multi-agent workflows in one
local-first application.

The key idea is simple: an agent workflow is not only a prompt and a model.
It is an editable architecture with roles, personas, routing, context policy,
tool access, durable execution events, and an inspectable result.

> **Local-first by design.** Kalio sends LLM traffic from your backend to the
> provider you configure. Session files, memory, credentials, and execution
> history are stored in your local data directory. Configured providers and
> external agent runtimes receive the prompts and context sent to them.

## At a glance

| Surface | What it gives you |
| --- | --- |
| **Talk** | Streaming chat with a multi-step tool loop, queues, attachments, and session history. |
| **Architect** | Versioned architecture schemas, role slots, personas, graph nodes, edges, and routing policies. |
| **Inspect** | Timeline, graph, chat, tool calls, runtime events, and audit evidence for each run. |
| **Own your data** | Sandboxed workspaces, semantic memory, project context, SQLite persistence, and encrypted provider secrets. |

## Install Kalio on Windows

Open **Command Prompt (`cmd.exe`)** and run this one line. The installer uses the
local production profile and the mock provider, so no API key is required:

~~~bat
curl.exe -fsSL https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install.cmd -o "%TEMP%\kalio-install.cmd" && call "%TEMP%\kalio-install.cmd" && del "%TEMP%\kalio-install.cmd"
~~~

Autostart after Windows sign-in is enabled by default. To install without it,
pass `-NoAutostart` to the downloaded CMD wrapper. The opt-out is remembered
across updates and repairs; pass `-EnableAutostart` to turn it back on. The
installer also places a **Kalio icon on the Desktop**: double-clicking it starts
the server and opens the app in your browser (clicking again while Kalio is
running just opens the page). Opt out with `-NoDesktopIcon`. To use
Bun instead of the default Node runtime, pass `-Runtime bun`.

~~~bat
curl.exe -fsSL https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install.cmd -o "%TEMP%\kalio-install.cmd" && call "%TEMP%\kalio-install.cmd" -Runtime bun && del "%TEMP%\kalio-install.cmd"
~~~

PowerShell remains available as an alternative:

~~~powershell
irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install-release.ps1 | iex
~~~

Open **http://127.0.0.1:4016**. The API health endpoint is
**http://127.0.0.1:4016/api/health**.

1. Open **Settings**.
2. Keep mock for a fully offline first run, or add a provider.
3. Create a session in **Talk**.
4. Send a message and approve tool calls when the HITL prompt appears.

To update an installed Windows runtime, run:

~~~powershell
& "$env:LOCALAPPDATA\Kalio\bin\kalio.cmd" update
~~~

The safe update waits while Kalio is running, verifies the downloaded runtime,
health-checks the new version, and rolls back on failure. User data is preserved.
For a repair, run the CMD installer again; it will not replace a running runtime.

See the [Windows user guide](docs/quickstart-user.md) for upgrades,
uninstall, data locations, and troubleshooting.

## Install Kalio on Linux

The command-line installer downloads the latest published runtime archive and keeps
the SQLite database and workspaces in the user data directory:

~~~bash
curl -fsSL https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install-release.sh -o /tmp/kalio-install.sh && bash /tmp/kalio-install.sh
~~~

For the Bun runtime:

~~~bash
curl -fsSL https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install-release.sh -o /tmp/kalio-install.sh && bash /tmp/kalio-install.sh --runtime bun
~~~

The installer also creates a **Kalio desktop entry** (application menu icon)
that starts Kalio and opens the app. Opt out with `--no-desktop-icon`.

See the [Linux installation guide](docs/linux-installation.md).

## Optional Tauri/NSIS desktop installer

The Tauri/NSIS desktop installer is optional. Use it when you specifically want
the native desktop shell; the CMD installation above is the primary Windows path.
Releases ship `Kalio_1.0.3_x64-setup.exe` on the
[releases page](https://github.com/Radomiej/kalio-forever/releases). The desktop
backend uses `http://127.0.0.1:4516`.

## Data and safety

| Data | Default location | Purpose |
| --- | --- | --- |
| SQLite database | $WORKSPACE_ROOT/kalio.db | Sessions, messages, personas, credentials, and audit log. |
| Semantic memory | $WORKSPACE_ROOT/memory/ | Per-persona vector stores. |
| Project Context | `$MEMORY_DB_PATH/project-resources/<project-hash>/<embedding-space-hash>.db` | Local per-project, per-model chunks and vectors; stored outside the project checkout. |
| Session files | $WORKSPACE_ROOT/sessions/{id}/ | Sandboxed workspace for one chat session. |
| RA-App catalog | $WORKSPACE_ROOT/ra-apps or RA_APPS_PATH | Versioned stored apps. |

Provider secrets are encrypted at rest with `CREDENTIALS_MASTER_KEY`. Agents
can read and write only inside the workspace assigned to their session.

## Documentation

| Document | Purpose |
| --- | --- |
| [Quick start for users](docs/quickstart-user.md) | Windows install, autostart, upgrades, uninstall, and troubleshooting. |
| [Linux installation](docs/linux-installation.md) | Linux installer, data locations, and service setup. |
| [Testing Kalio on Windows](docs/testing-kalio.md) | QA stack, manual smoke test, and installed-release checks. |
| [Specs and development docs](docs/spec/) | Architecture, runtime, local development, and design documents. |
| [Runtime boundary spec](project-spec.md) | Durable product and runtime boundaries. |

Contributing or working with AI agents? Start with
[CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md), then the
[local development guide](docs/spec/local-dev-guide.md).

## Community and licensing

Kalio is source-available under the
[PolyForm Noncommercial License 1.0.0](./LICENSE). This permits personal,
hobby, educational, and other noncommercial use. It is not an OSI-approved
open-source license.

Commercial use, embedding Kalio in a paid product, redistribution, resale,
white-labeling, hosted services, and paid client delivery require a separate
commercial license. See [commercial licensing](./COMMERCIAL-LICENSE.md) and
the [agreement template](./COMMERCIAL-LICENSE-AGREEMENT-TEMPLATE.md).

Contributions follow the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).
