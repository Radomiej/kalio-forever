# `.kalio/config.toml` — Configuration Reference

Kalio reads one or more TOML configuration files at startup and every 30 seconds
thereafter (cache TTL). Values in these files take priority over anything saved
through the Settings UI or the REST API. The file is optional; the application
runs with built-in defaults when none is present.

For MCP specifically, Kalio uses a dual-store model:

- `.kalio/config.toml` is the canonical source for repo/dev-managed MCP config.
- `mcp_servers` in SQLite remains the app-local MCP store used by Settings UI imports and manual additions.
- Equivalent TOML and SQLite entries remain separately visible; TOML wins only as the active runtime entry for that conflict group.

---

## Where to place the file

Kalio merges configuration from multiple layers, innermost (project-specific) wins:

| Priority | Path | When to use |
|----------|------|-------------|
| Highest | `<repo-root>/.kalio/config.toml` | Per-project settings checked into git |
| ↕        | `<sub-directory>/.kalio/config.toml` | Nested workspace overrides |
| Lowest | `~/.kalio/config.toml` | Personal machine-wide defaults |

The project root is detected by walking up from the current working directory
until a `.git` directory is found. Any `.kalio/config.toml` files above the
project root are **ignored**.

> **For Kalio-Forever development the file lives at:**
> ```
> c:\Projekty\kalio-forever\.kalio\config.toml
> ```
> or in your home directory:
> ```
> %USERPROFILE%\.kalio\config.toml
> ```

---

## Full schema

```toml
# ── Runtime ─────────────────────────────────────────────────────────────────
[runtime]
context_window_size = 32000   # tokens sent to the LLM in each turn
max_tool_attempts   = 30      # how many tool calls the agent loop allows per turn
temperature         = 0.7
max_tokens          = 4096

# ── Tool timeouts ────────────────────────────────────────────────────────────
# Values are in milliseconds.  Omit a key to fall back to the stored UI value.
[tool_timeouts]
web_search_timeout_ms      = 120000   # 15 000 – 600 000
provider_local_timeout_ms  = 3000     # 1 000 – 30 000
provider_remote_timeout_ms = 15000    # 5 000 – 120 000

# ── CLI agent overrides ──────────────────────────────────────────────────────
# Each sub-table key must match a registered adapter id: copilot, gemini, claude, codex.
# Omit the entire section to fall back to the per-agent JSON config files at
# ~/.kalio/cli-agents/<id>.json.
[cli_agents.codex]
enabled        = true
cli_path       = ""            # empty = resolve from PATH
timeout_ms     = 600000        # 1 000 – 1 200 000
max_output_chars = 16000       # min 1 000
model          = ""            # e.g. "o4-mini"
extra_args     = []

[cli_agents.gemini]
enabled  = true
model    = "gemini-2.5-pro"
extra_args = ["--yolo"]

# ── HITL ────────────────────────────────────────────────────────────────────
[hitl]
mode           = "auto"        # "manual" | "auto" | "bypass"
auto_persona_id = null

# ── Features ─────────────────────────────────────────────────────────────────
[features]
mcp = true

# ── MCP servers ──────────────────────────────────────────────────────────────
[mcp_servers.my-docs-server]
command  = "npx"
args     = ["-y", "my-docs-mcp@latest"]
enabled  = true
required = false

[mcp_servers.my-docs-server.tool_overrides.search_docs]
approval_mode = "auto"   # "auto" | "prompt" | "approve"
```

---

## Agent QA MCP profile

Kalio agents that validate architecture runs need the same QA stack that Codex
uses manually:

- `mcp-dev-servers` for starting, restarting, and inspecting the Kalio stack.
- `mcp-playwright-orchestrator` for browser sessions, screenshots, visual
  audits, WCAG checks, focus checks, and runtime console evidence.

For Kalio-Forever development, TOML is the canonical repo/dev-managed MCP path:

```text
docs/examples/kalio-agent-qa-mcp.config.toml
```

Copy the required blocks into `.kalio/config.toml` or
`%USERPROFILE%\.kalio\config.toml`. This is the canonical local-dev setup for
this repo.

The repo also keeps `.vscode/mcp.json` as a legacy/manual import example for
one-off UI inspection or importer debugging. Do not use it as the normal dev
path.

Imported SQLite entries are still valid Kalio config, but they are not the
canonical repo/dev-managed store. If TOML and SQLite contain equivalent MCP
config, both rows remain visible in Settings and only the TOML row is active at
runtime; the SQLite row is marked `shadowed`.

---

## Source-of-truth rules

When a value is present in `.kalio/config.toml`:

- **Reads** always return the TOML value (after bounds-clamping).
- **Writes via the Settings UI or REST API are rejected** with `400 Bad Request`
  and a message like:
  ```
  Timeout settings managed by .kalio/config.toml cannot be set via the API: webSearchTimeoutMs
  ```
  or, for CLI agents:
  ```
  CLI agent codex is managed by .kalio/config.toml
  ```
- The cached value is refreshed automatically **every 30 seconds**.
  Call `KalioConfigService.invalidateCache()` from code if you need an immediate
  reload (e.g. after writing the file programmatically).

For MCP server config there is one important exception to the generic rule
above:

- TOML does not delete or overwrite SQLite MCP rows.
- Settings UI and external import can still create SQLite MCP entries.
- Runtime conflict resolution is `visible != active`: equivalent TOML and
  SQLite entries are both listed, but only one runtime handle is activated.
- In the current policy, `TOML > SQLite` for equivalent MCP config.

---

## Bounds clamping

Values that fall outside the safe range are silently clamped on read:

| Field | Min | Max |
|-------|-----|-----|
| `tool_timeouts.web_search_timeout_ms` | 15 000 | 600 000 |
| `tool_timeouts.provider_local_timeout_ms` | 1 000 | 30 000 |
| `tool_timeouts.provider_remote_timeout_ms` | 5 000 | 120 000 |
| `cli_agents.<id>.timeout_ms` | 1 000 | 1 200 000 |
| `cli_agents.<id>.max_output_chars` | 1 000 | ∞ |

Non-finite (NaN, ±Infinity) values are replaced with the built-in default.

---

## Minimal working example

```toml
# .kalio/config.toml — project-level overrides for this repo

[runtime]
max_tool_attempts = 12

[tool_timeouts]
web_search_timeout_ms = 60000

[cli_agents.gemini]
enabled   = true
model     = "gemini-2.5-pro"
extra_args = ["--yolo"]
```

---

## FAQ

**Q: My TOML edit doesn't take effect immediately.**  
A: The config is cached for 30 seconds. Wait, or restart the API process.

**Q: The Settings UI slider is greyed out / saves show an error.**  
A: A key managed by TOML cannot be overridden through the UI.
Remove the key from `.kalio/config.toml` to allow UI control again.

**Q: I see a parse error in the API logs.**  
A: The file contains invalid TOML. The API will fail to start (or log an error
on reload). Run `npx @iarna/toml parse .kalio/config.toml` to validate.

**Q: Which file wins when the same key appears in both `~/.kalio/config.toml` and `.kalio/config.toml`?**  
A: The project-level file wins (deeper paths have higher priority). Within the
same scope, a deeper sub-directory config wins over the project root config.

**Q: Can I diagnose Kalio MCP state from `~/.codex/config.toml`?**  
A: No. `~/.codex/config.toml` configures Codex only. Kalio MCP state should be
diagnosed from `.kalio/config.toml`, `~/.kalio/config.toml`, and the Kalio
runtime/API state.

**Q: Why do I see the same MCP server twice in Settings?**  
A: Kalio keeps TOML and SQLite MCP stores separately. Equivalent entries remain
visible as separate rows. If they conflict, the TOML row is active and the
SQLite row is marked `shadowed`.
