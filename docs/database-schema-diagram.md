# Database Schema Diagram

Kalio uses **SQLite** via **Drizzle ORM**. Schema source of truth: `apps/kalio-api/src/database/schema.ts`.  
All migrations live in `apps/kalio-api/src/database/migrations/`.

---

## Entity Relationship Diagram

```mermaid
erDiagram

    personas {
        text id PK
        text name
        text system_prompt
        text model
        json skills
        text mcp_policy
        integer created_at
        integer updated_at
    }

    sessions {
        text id PK
        text persona_id FK
        text title
        integer created_at
        integer updated_at
    }

    messages {
        text id PK
        text session_id FK
        text role
        text content
        text thinking
        json tool_calls
        text tool_call_id
        json attachments
        integer created_at
    }

    persona_kv {
        text id PK
        text persona_id FK
        text key
        text value
        integer updated_at
    }

    app_settings {
        text key PK
        text value
        integer updated_at
    }

    credentials {
        text id PK
        text name
        text provider
        text api_key
        text base_url
        text model
        integer created_at
    }

    embedding_credentials {
        text id PK
        text name
        text provider
        text api_key
        text base_url
        text model
        integer dimensions
        integer created_at
    }

    mcp_servers {
        text id PK
        text name
        text transport
        text url
        text command
        json args
        json env_vars
        json headers
        integer enabled
        text status
        integer tool_count
        text last_error
        integer created_at
    }

    skills {
        text id PK
        text name
        text description
        text prompt
        text source
        integer created_at
        integer updated_at
    }

    tool_overrides {
        text tool_name PK
        integer requires_confirmation
        integer updated_at
    }

    allowed_paths {
        text id PK
        text path
        integer created_at
    }

    raapp_pending_approvals {
        text id PK
        text session_id FK
        text tool_call_id
        text system
        json args
        text output_path
        text display_label
        text status
        json result
        integer created_at
    }

    audit_log {
        text id PK
        text session_id
        text type
        text label
        json data
        integer duration_ms
        integer chunk_count
        integer created_at
    }

    personas ||--o{ sessions : "has"
    sessions ||--o{ messages : "contains"
    personas ||--o{ persona_kv : "stores"
    sessions ||--o{ raapp_pending_approvals : "generates"
```

---

## Table Reference

### `personas`
Stores AI personas. Each persona defines a system prompt, a default model, an MCP access policy, and an optional list of allowed skills.

### `sessions`
Chat sessions. Each session belongs to one persona. Scopes all messages, VFS files (`sessions/{id}/files/`), and KV state (`sessions/{id}/_kv.json`).

### `messages`
Ordered turn history per session. `role` can be `user`, `assistant`, `tool_result`, or `system`. Stores tool call metadata and file attachments.

### `persona_kv`
Key-value store per persona. Used by the `kv_*` tools (LLM-writable persistent state).

### `app_settings`
Single-table key-value config store. Used for persisting global settings (e.g. default model).

### `credentials`
LLM provider API keys + base URLs. Referenced when building LLM clients for chat sessions.

### `embedding_credentials`
Embedding provider API keys (OpenAI, custom). Used by `MemoryModule` for vector storage.

### `mcp_servers`
MCP server configs. `MCPService` reads this on boot and connects to all `enabled` servers.  
`status` is live-updated and broadcast via Socket.IO events.

### `skills`
User- or agent-defined prompt snippets injected into the system prompt. Also used as an `allow_list` filter for native and MCP tools.

### `tool_overrides`
Per-tool overrides for the `requiresConfirmation` flag (primary key: `tool_name`). Allows users to disable HITL for specific tools or enable it for safe-by-default ones.

### `allowed_paths`
Filesystem roots the agent can access via `fs_*` tools. Enforced by `AllowedPathsService` before any read/write.

### `raapp_pending_approvals`
Stores `call_native` approval requests that require explicit user confirmation before the tool executes. Status transitions: `pending → approved | cancelled | executed | error`.

### `audit_log`
Full audit trail per session. Records every LLM request/response, tool call, tool result, and error with timing and token data.  
`type` enum: `llm_request`, `llm_response`, `tool_call`, `tool_result`, `error`, `raapp_native_call`, `raapp_native_approved`.

---

## Notes

- All timestamps use `integer({ mode: 'timestamp_ms' })` — Unix milliseconds stored as integers.
- `api_key` fields are stored in plaintext in the MVP. Post-MVP plan: `libsodium` secretbox encryption.
- `sessions` and `messages` cascade-delete: removing a persona removes all its sessions and messages.
- There is no `workspaceId` — session is the unit of isolation.
