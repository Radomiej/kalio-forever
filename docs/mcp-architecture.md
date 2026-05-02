# MCP Architecture

This document describes how MCP (Model Context Protocol) integration works in Kalio — from server configuration and tool discovery through to LLM-driven tool invocation.

---

## Modules and Services

| Service / Class | Location | Responsibility |
|---|---|---|
| `MCPService` | `modules/mcp/mcp.service.ts` | MCP server lifecycle: connect, reconnect, health-check, tool discovery |
| `MCPController` | `modules/mcp/mcp.controller.ts` | REST API: `GET/POST /mcp/servers`, `DELETE /mcp/servers/:id`, `POST /mcp/servers/:id/restart`, `GET /mcp/tools` |
| `MCPModule` | `modules/mcp/mcp.module.ts` | NestJS module; exports `MCPService` |
| `MCPWatchdogService` | `modules/mcp/mcp-watchdog.service.ts` | Watchdog stub (planned Phase 8) |
| `ToolDispatchService` | `modules/chat/tool-dispatch.service.ts` | Merges native + MCP tools into a single `getToolMetas()` call; routes `dispatch()` to either native tools or MCP servers |
| `ChatService` | `modules/chat/chat.service.ts` | Orchestrates each turn: filters tools per `MCPPolicy`, builds `effectiveSystemPrompt` |
| `ChatModule` | `modules/chat/chat.module.ts` | Imports `MCPModule` — enables `@Optional()` injection of `MCPService` into `ToolDispatchService` |

---

## Wire Types (`@kalio/types`)

```ts
type MCPPolicy = 'allow_all' | 'deny_all' | 'allow_list';

interface MCPServer {
  id: ID;
  name: string;
  transport: 'stdio' | 'http';
  url?: string;
  command?: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'stopped';
  toolCount?: number;
  lastError?: string;
  createdAt: Timestamp;
}

interface MCPTool {
  name: string;          // prefixed: "mcp_{serverId}_{originalName}"
  description: string;
  serverId: ID;
  requiresConfirmation: boolean;
  parameters: Record<string, unknown>;
}

interface CreateMCPServerDto {
  name: string;
  transport: 'stdio' | 'http';
  url?: string;          // for http transport
  command?: string;      // for stdio transport
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}
```

### Database Schema (`mcp_servers`)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | nanoid assigned at `addServer()` |
| `name` | TEXT | Display name shown in UI |
| `transport` | `'stdio'\|'http'` | Transport type |
| `url` | TEXT | URL for http transport (e.g. `http://localhost:3000/mcp`) |
| `command` | TEXT | Command for stdio transport (e.g. `docker`) |
| `args` | JSON | stdio command arguments |
| `env_vars` | JSON | Environment variables for stdio transport |
| `headers` | JSON | Extra HTTP headers |
| `enabled` | BOOLEAN | Whether to connect on startup |
| `status` | TEXT | Last known connection status |
| `tool_count` | INTEGER | Number of discovered tools |
| `last_error` | TEXT | Last error message |
| `created_at` | INTEGER | Unix timestamp (ms) |

---

## Per-Persona MCP Access Strategy

`personas.mcp_policy` controls which MCP tools are visible to the LLM in any given session:

| Value | Behavior |
|---|---|
| `allow_all` | LLM sees all tools from all connected MCP servers |
| `deny_all` | LLM sees no MCP tools |
| `allow_list` | LLM sees only MCP tools whose names appear in `persona.skills[]` |

---

## Tool Naming Convention

MCP tools are **prefixed** during discovery:

```
mcp_{serverId}_{originalName}
```

Example: server `abc123` with tool `run_container` → `mcp_abc123_run_container`

The mapping is stored in `MCPService.toolNameMap: Map<prefixedName, { serverId, originalName }>`.

At dispatch time: `dispatch("mcp_abc123_run_container", ...)` → `resolveToolName()` → `callTool("abc123", "run_container", args)`.

---

## Diagrams

### Startup — tool discovery

```mermaid
flowchart TD
    A[API Boot\nNestJS bootstrap] --> B[MCPService.onModuleInit]
    B --> C{Enabled servers\nin DB?}
    C -- No --> D[No-op]
    C -- Yes --> E[Promise.allSettled\nfire-and-forget]
    E --> F[connectHandle per server]
    F --> G[createTransport\nstdio → StdioClientTransport\nhttp → StreamableHTTPClientTransport]
    G --> H[client.connect]
    H -- fail --> I[status = error\npersistStatus\nattemptRestart]
    H -- ok --> J[discoverTools\nclient.listTools]
    J --> K[prefix each tool\nmcp_serverId_name\nstore in toolNameMap]
    K --> L[status = connected\npersistStatus\nemit status via Socket.IO]
    L --> M[healthTimer every 30s\nclient.listTools as ping]
    M -- fail --> I
```

### Per-turn — from message to tool call

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant GW as ChatGateway
    participant CS as ChatService
    participant TD as ToolDispatchService
    participant MCP as MCPService
    participant LLM as LLMService
    participant EXT as External MCP Server

    FE->>GW: chat:send {sessionId, content, personaId}
    GW->>CS: handleTurn()
    CS->>CS: getSessionConfig(personaId)\n→ systemPrompt, mcpPolicy, skills
    CS->>TD: getToolMetas()
    TD->>TD: static tools from toolMap
    TD->>MCP: getAllTools() [connected servers only]
    MCP-->>TD: MCPTool[]
    TD-->>CS: ToolMeta[] (native + MCP merged)
    CS->>CS: filterTools(mcpPolicy)\nallow_all / deny_all / allow_list
    CS->>CS: build effectiveSystemPrompt\n+ Available tools section
    CS->>GW: emit chat:context {systemPrompt, toolNames}
    GW->>FE: chat:context
    CS->>LLM: stream({messages, tools: toolMetas})
    LLM-->>CS: chunks (text_delta, tool_call, done)
    CS->>GW: emit chat:chunk (live stream)
    GW->>FE: chat:chunk

    note over CS: LLM requests tool call
    CS->>GW: emit tool:start {callId, toolName}
    GW->>FE: tool:start

    CS->>TD: dispatch(callId, toolName, args, ctx, toolMetas)

    alt Native tool
        TD->>TD: entry = toolMap.get(toolName)
        TD->>TD: check requiresConfirmation → HITL if needed
        TD->>TD: entry.execute(ToolCallRequest)
    else MCP tool (name starts with mcp_)
        TD->>MCP: resolveToolName(toolName)\n→ {serverId, originalName}
        TD->>MCP: callTool(serverId, originalName, args)
        MCP->>EXT: client.callTool({name, arguments})
        EXT-->>MCP: result
        MCP-->>TD: data
    else Unknown
        TD-->>CS: {status: error, TOOL_NOT_FOUND}
    end

    TD-->>CS: ToolResult
    CS->>GW: emit tool:result
    GW->>FE: tool:result
```

### Per-persona tool filtering

```mermaid
flowchart LR
    ALL[All tools\nnative + MCP] --> SPLIT{split}
    SPLIT --> NAT[Native tools\nnot startsWith mcp_]
    SPLIT --> MCPT[MCP tools\nstartsWith mcp_]

    NAT --> NS{skills == empty?}
    NS -- "Yes → all native" --> MERGE
    NS -- "No → filter by skills[]" --> MERGE

    MCPT --> MP{mcpPolicy}
    MP -- allow_all --> MERGE
    MP -- deny_all --> DROP[dropped]
    MP -- allow_list --> MF["filter: name in skills[]"]
    MF --> MERGE

    MERGE["Filtered ToolMeta[]"] --> LLM[LLM sees these tools]
```
