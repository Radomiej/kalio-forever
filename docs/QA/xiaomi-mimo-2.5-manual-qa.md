# Xiaomi MiMo 2.5 Manual QA Flow (Chat + Graph + Persona/Subagent + RAApp + Native Tools)

Use this with the dedicated E2E lane (non-dev ports). Before UI checks, confirm both URLs come from the current E2E run.

## Baseline port guard

- `PLAYWRIGHT_BASE_URL` (frontend)
- `TEST_API_URL` (backend `/api`)

Stop if either includes ports `3016`, `3316`, `5188`, `5288`.

```powershell
powershell -NoProfile -Command "$env:PLAYWRIGHT_BASE_URL; $env:TEST_API_URL"
```

## Live provider gate

Before manual Xiaomi checks, start the managed preview stack and probe the provider through the backend:

```powershell
pnpm stack:start -- --use-env-llm --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1
pnpm llm:probe -- --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1
```

The managed stack uses `data/kalio-qa.db`, `data/workspaces-qa`, and mock LLM settings by default so saved dev credentials, relay integrations, or live provider tokens do not leak into QA. Use `--use-env-llm` only for intentional live-provider validation. Pass `--database-path` or `--workspace-root` only when a test intentionally needs a specific data set.

`llm:probe` refuses non-local API URLs by default because it sends the configured provider key to the running backend's `/api/credentials/test` endpoint. Use `--allow-remote-api-url` only for an intentional remote QA backend.

Stop manual QA if `llm:probe` returns `ok: false`. A `401 Invalid API Key` means the app and stack can reach Xiaomi, but the configured key is not accepted by Xiaomi; chat, persona/subagent, design-generation, RAApp-generation, and native-tool LLM paths cannot be validated live until the key is replaced.

## 1) Chat baseline

Selectors:

- `nav-talk`
- `talk-sidebar-conversation-entry`, `talk-sidebar-graph-entry`, `talk-view-conversation`
- `new-session-btn`, `session-item`
- `chat-input-area`, `chat-input`, `chat-send-btn`
- `message-list`, `message-bubble`, `agent-turn-bubble`
- `tool-call-bubble`, `tool-call-chip`, `message-content`

Checks:

1. Open `nav-talk` and confirm `talk-view-conversation` shows active.
2. Create/select a session with `new-session-btn` / `session-item`.
3. Send a seed prompt (example: "list_raapps and summarize the active persona state").
4. Verify a user bubble and assistant bubble appear in `message-list`.
5. If a tool-capable path was triggered, confirm at least one `tool-call-bubble` is visible.
6. Confirm the composer re-enables after completion (`chat-input` enabled).

API checks:

- `GET ${TEST_API_URL}/sessions`
- `POST ${TEST_API_URL}/sessions`
- `GET ${TEST_API_URL}/sessions/{id}/messages`
- `GET ${TEST_API_URL}/sessions/{id}/runs/current`
- `GET ${TEST_API_URL}/llm/config` (frontend uses this to confirm mock provider in E2E)

## 2) Graph readability

Selectors:

- `talk-sidebar-graph-entry`
- `execution-graph-view`, `execution-graph-viewport`, `execution-graph-stage`
- `graph-node-{...}`, `graph-edge-{...}`
- `graph-zoom-in`, `graph-zoom-out`, `graph-zoom-reset`
- `graph-inspector-resize-handle`
- `execution-graph-inspector`

Checks:

1. Open a session with at least one tool call/subagent node.
2. From Talk, select Graph (`talk-sidebar-graph-entry`) and verify `execution-graph-view` renders.
3. Verify at least one visible `graph-node-*` and corresponding `graph-edge-*` for non-empty runs.
4. Use zoom controls; confirm graph does not blank and remains readable.
5. Drag the inspector resize handle and ensure no overlap/content clipping.

API checks:

- `GET ${TEST_API_URL}/sessions/{id}/messages`
- `GET ${TEST_API_URL}/sessions/{id}/runs/current`

## 3) Persona and subagent behavior

Selectors:

- `nav-mind`
- `mind-tab-personas`
- `persona-panel`, `new-persona-btn`, `persona-item`
- `persona-name-input`, `persona-model-input`, `persona-prompt-textarea`
- `persona-save-btn`, `persona-delete-btn`
- `tool-toggle-*`, `mcp-policy-*`
- `tool-call-bubble` (`run_subagent` marker in call content/text)

Checks:

1. Open `nav-mind` -> `mind-tab-personas`.
2. Create a temporary persona with a unique name/model.
3. Confirm `persona-item` renders and appears in the list.
4. Run/trigger a prompt that should produce `run_subagent`.
5. Confirm subagent path is visible in graph or tool bubbles, and message stream references child-session context.

API checks:

- `GET ${TEST_API_URL}/personas`
- `POST ${TEST_API_URL}/personas`
- `GET ${TEST_API_URL}/personas/{id}`
- `POST ${TEST_API_URL}/personas/{id}/graph/validate`
- `DELETE ${TEST_API_URL}/personas/{id}`

## 4) RAApp generation and design page surface

Selectors:

- `nav-tools`
- `tools-tab-raapps`
- `raapp-manager`
- `raapp-catalog-*`, `raapp-catalog-run-*`
- `raapp-group-*`, `raapp-work-open-vfs-*`, `raapp-work-draft-*`, `raapp-work-test-*`, `raapp-work-run-*`, `raapp-work-publish-*`
- `raapp-catalog-run-*`
- `gui-dsl-renderer`, `gui-button`
- `raapp-iframe`
- `raapp-iframe-fullscreen`

Checks:

1. Open `Tools` -> `tools-tab-raapps`.
2. Confirm the catalog appears (`raapp-manager`) and cards are visible (`raapp-catalog-*`).
3. Trigger a RA-App related message in chat and verify a preview is returned in `gui-dsl-renderer` or `raapp-iframe`.
4. Exercise at least one `gui-button` in the rendered result.
5. Open RAApp VFS link (`raapp-work-open-vfs-*`) if present.

API checks:

- `GET ${TEST_API_URL}/ra-apps`
- `GET ${TEST_API_URL}/ra-apps/groups`
- `GET ${TEST_API_URL}/ra-apps/groups/{slug}`
- `GET ${TEST_API_URL}/ra-apps/{id}`
- `POST ${TEST_API_URL}/ra-apps/upload`
- `DELETE ${TEST_API_URL}/ra-apps/{id}`
- `GET ${TEST_API_URL}/ra-apps/groups/{slug}/download/{version}`

## 5) Native tools and Xiaomi flow

Selectors:

- `tool-call-bubble`, `tool-call-chip`
- `tool-activity-row`, `tool-arg-progress-indicator`, `args-preview`, `args-expanded`
- `confirmation-args-toggle`
- `confirmation-actions`, `confirmation-confirm-btn`, `confirmation-cancel-btn`

Checks:

1. Trigger a tool path expected to use a native tool.
2. Confirm `tool-call-bubble` and `tool-call-chip` are shown.
3. Validate arg/result progression:
   - `tool-arg-progress-indicator` updates while args stream, or
   - `args-preview` updates and can be expanded (`args-expanded`).
4. For manual-confirm tools, validate confirm/cancel controls and status transitions (`tool-activity-row[data-status="running|awaiting_confirmation|success|error"]`).

API checks:

- `GET ${TEST_API_URL}/tools`
- `PATCH ${TEST_API_URL}/tools/{name}`
- `GET ${TEST_API_URL}/credentials`
- `GET ${TEST_API_URL}/credentials/active`
- `POST ${TEST_API_URL}/credentials/{id}/test`
- `POST ${TEST_API_URL}/credentials/test`

## 6) VFS and artifact checks

Selectors:

- `vfs-explorer`, `vfs-file`
- `conversation-files-toggle`, `conversation-files-modal`, `conversation-files-zip`, `conversation-files-preview`, `conversation-files-refresh`

API checks:

- `GET ${TEST_API_URL}/sessions/{id}/vfs`
- `POST ${TEST_API_URL}/sessions/{id}/vfs`
- `GET ${TEST_API_URL}/sessions/{id}/vfs/read?path=...`
- `GET ${TEST_API_URL}/sessions/{id}/vfs/serve?path=...`
- `GET ${TEST_API_URL}/sessions/{id}/vfs/serve-path/...`
