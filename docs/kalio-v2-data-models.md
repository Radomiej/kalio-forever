# 📐 Kalio v2 — Data Models & Flow Models

> **Version:** 0.1 | **Date:** 2026-04-21
> **Powiązane:** kalio-v2-mvp-spec.md, kalio-v2-tdd-plan.md

---

## 1. @kalio/types — kompletne interfejsy

> Plik: `packages/@kalio/types/src/index.ts`
> **Zasada:** zero duplikacji. Jeśli typ nie jest tu zdefiniowany, nie istnieje.

```typescript
// ─── Core primitives ────────────────────────────────────────────────────────
export type ID = string;                      // nanoid() — 21 chars
export type Timestamp = number;               // Unix ms (Date.now())
export type ISOString = string;               // ISO 8601

// ─── LLM Layer ──────────────────────────────────────────────────────────────
export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMMessage {
  role: LLMRole;
  content: string;
  toolCallId?: string;   // for role='tool' responses
  name?: string;         // for role='tool' — tool name
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
  sessionId: ID;
  messageId: ID;
}

export interface LLMToolCall {
  id: string;            // tool_call_id from provider
  name: string;
  args: Record<string, unknown>;
}

export interface LLMConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
}

export type LLMProviderType = 'openai-compatible' | 'mock';

// ─── Persona ─────────────────────────────────────────────────────────────────
export interface Persona {
  id: ID;
  name: string;
  systemPrompt: string;
  model: string;          // e.g. "claude-sonnet-4-6", "gpt-4o", "qwen3:8b"
  skills: string[];       // tool names available to this persona
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PersonaKV {
  id: ID;
  personaId: ID;
  key: string;
  value: string;           // JSON-serializable string
  updatedAt: Timestamp;
}

export interface PersonaSessionConfig {
  systemPrompt: string;
  model: string;
  availableSkills: string[];  // filtered tool list for this session
  kv: Record<string, string>; // all KV entries for this persona
}

export interface CreatePersonaDto {
  name: string;
  systemPrompt: string;
  model: string;
  skills: string[];
}

export interface UpdatePersonaDto {
  name?: string;
  systemPrompt?: string;
  model?: string;
  skills?: string[];
}

// ─── Session / Chat ──────────────────────────────────────────────────────────
export type MessageRole = 'user' | 'assistant' | 'tool_result' | 'system';

export interface ChatMessage {
  id: ID;
  sessionId: ID;
  role: MessageRole;
  content: string;
  toolCalls?: LLMToolCall[];    // populated for assistant messages with tool use
  toolCallId?: string;          // populated for role='tool_result'
  streaming?: boolean;          // FE only — true while chunk stream is open
  createdAt: Timestamp;
}

export interface ChatSession {
  id: ID;
  personaId: ID;
  title: string;               // auto-generated from first message
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateSessionDto {
  personaId: ID;
  title?: string;
}

// ─── Tools ───────────────────────────────────────────────────────────────────
export interface ToolMeta {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  requiresConfirmation: boolean;        // HITL gate flag
}

export interface ToolCallRequest {
  sessionId: ID;
  conversationId: ID;
  toolName: string;
  args: Record<string, unknown>;
  callId: string;               // matches LLMToolCall.id
}

export interface ToolResult {
  callId: string;
  status: 'success' | 'error' | 'cancelled';
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export interface ToolConfirmationRequest {
  requestId: string;            // unique per confirmation instance
  sessionId: ID;
  toolName: string;
  args: Record<string, unknown>;
  timeoutMs: number;            // default 30000
}

// ─── VFS ─────────────────────────────────────────────────────────────────────
export interface VFSFile {
  conversationId: ID;
  path: string;                 // relative to conversations/{id}/files/
  sizeBytes: number;
  mimeType?: string;
  updatedAt: Timestamp;
}

export interface VFSWriteRequest {
  conversationId: ID;
  filePath: string;
  content: string;
}

export interface VFSReadResult {
  conversationId: ID;
  filePath: string;
  content: string;
}

export interface VFSListResult {
  conversationId: ID;
  files: VFSFile[];
}

// ─── Credentials ─────────────────────────────────────────────────────────────
// NOTE: apiKey is NEVER included in this interface — never exposed after creation
export interface Credential {
  id: ID;
  name: string;
  provider: string;             // e.g. "CometAPI", "OpenRouter", "Ollama"
  baseUrl?: string;
  model?: string;
  createdAt: Timestamp;
}

export interface CreateCredentialDto {
  name: string;
  provider: string;
  apiKey: string;               // write-only, never returned
  baseUrl?: string;
  model?: string;
}

// ─── MCP ─────────────────────────────────────────────────────────────────────
export type MCPServerStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface MCPServer {
  id: ID;
  name: string;
  url: string;
  status: MCPServerStatus;
  toolCount?: number;
  lastError?: string;
  createdAt: Timestamp;
}

export interface MCPTool {
  name: string;                 // namespaced: "{serverId}::{toolName}"
  description: string;
  serverId: ID;
  requiresConfirmation: boolean;
  parameters: Record<string, unknown>;
}

// ─── RA-App DSL ───────────────────────────────────────────────────────────────
export type RAAppMode = 'display' | 'interactive';
export type RAAppType = 'html' | 'gui';

export interface RAAppAction {
  label: string;
  tool: string;                  // tool name to call
  args: Record<string, unknown>;
  requiresConfirmation?: boolean; // inherits from tool if not set
}

export interface RAAppBlock {
  type: RAAppType;
  mode: RAAppMode;
  content: string;               // HTML string or GUI DSL YAML
  vfsPath?: string;              // optional: load content from VFS path
  actions?: RAAppAction[];       // only for mode='interactive'
}

export interface RAAppResult {
  status: 'ready' | 'error';
  renderedContent?: string;
  error?: {
    code: 'DSL_PARSE_ERROR' | 'DSL_EXEC_ERROR' | 'SANDBOX_ERROR';
    message: string;
    line?: number;
  };
  requiresHITL?: boolean;        // true when mode='interactive' and has actions
}

// ─── Socket.IO Event Map ─────────────────────────────────────────────────────
// This is the COMPLETE contract between FE and BE.
// All Socket.IO events must be defined here.
export interface SocketEvents {
  // Chat — client → server
  'chat:send': { sessionId: ID; content: string; personaId: ID; conversationId: ID; };

  // Chat — server → client
  'chat:chunk': LLMStreamChunk;
  'chat:complete': { sessionId: ID; messageId: ID; usage?: { promptTokens: number; completionTokens: number; }; };
  'chat:error': { sessionId: ID; code: 'PROVIDER_NOT_CONFIGURED' | 'LLM_ERROR' | 'TOOL_ERROR'; message: string; };

  // Tool HITL — server → client
  'tool:confirmation_required': ToolConfirmationRequest;

  // Tool HITL — client → server
  'tool:confirm': { requestId: string; sessionId: ID; };
  'tool:cancel': { requestId: string; sessionId: ID; };

  // Tool result — server → client
  'tool:result': ToolResult;

  // MCP — server → client
  'mcp:connected': { serverId: ID; serverName: string; toolCount: number; };
  'mcp:disconnected': { serverId: ID; reason: string; };
  'mcp:error': { serverId: ID; error: string; };

  // Sessions — server → client
  'session:created': ChatSession;
  'session:updated': Pick<ChatSession, 'id' | 'title' | 'updatedAt'>;
}
```

---

## 2. Drizzle Schema

> Plik: `apps/kalio-api/src/database/schema.ts`

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { LLMToolCall } from '@kalio/types';

// ─── personas ────────────────────────────────────────────────────────────────
export const personas = sqliteTable('personas', {
  id:           text('id').primaryKey(),
  name:         text('name').notNull(),
  systemPrompt: text('system_prompt').notNull().default(''),
  model:        text('model').notNull(),
  skills:       text('skills', { mode: 'json' }).$type<string[]>().notNull().default([]),
  createdAt:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:    integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── sessions ────────────────────────────────────────────────────────────────
export const sessions = sqliteTable('sessions', {
  id:        text('id').primaryKey(),
  personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  title:     text('title').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── messages ────────────────────────────────────────────────────────────────
export const messages = sqliteTable('messages', {
  id:          text('id').primaryKey(),
  sessionId:   text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role:        text('role', { enum: ['user', 'assistant', 'tool_result', 'system'] }).notNull(),
  content:     text('content').notNull(),
  toolCalls:   text('tool_calls', { mode: 'json' }).$type<LLMToolCall[] | null>(),
  toolCallId:  text('tool_call_id'),  // for role='tool_result'
  createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── persona_kv ──────────────────────────────────────────────────────────────
export const personaKV = sqliteTable('persona_kv', {
  id:        text('id').primaryKey(),
  personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  key:       text('key').notNull(),
  value:     text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── credentials ─────────────────────────────────────────────────────────────
export const credentials = sqliteTable('credentials', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  provider:  text('provider').notNull(),
  apiKey:    text('api_key').notNull(),    // encrypt post-MVP: libsodium secretbox
  baseUrl:   text('base_url'),
  model:     text('model'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── mcp_servers ─────────────────────────────────────────────────────────────
export const mcpServers = sqliteTable('mcp_servers', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  url:       text('url').notNull(),
  status:    text('status', {
    enum: ['connecting', 'connected', 'disconnected', 'error'],
  }).notNull().default('disconnected'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── Type inference helpers ───────────────────────────────────────────────────
export type PersonaRow       = typeof personas.$inferSelect;
export type SessionRow       = typeof sessions.$inferSelect;
export type MessageRow       = typeof messages.$inferSelect;
export type PersonaKVRow     = typeof personaKV.$inferSelect;
export type CredentialRow    = typeof credentials.$inferSelect;
export type MCPServerRow     = typeof mcpServers.$inferSelect;

export type InsertPersona    = typeof personas.$inferInsert;
export type InsertSession    = typeof sessions.$inferInsert;
export type InsertMessage    = typeof messages.$inferInsert;
export type InsertPersonaKV  = typeof personaKV.$inferInsert;
export type InsertCredential = typeof credentials.$inferInsert;
export type InsertMCPServer  = typeof mcpServers.$inferInsert;
```

---

## 3. Module → Data Ownership Map

> Każdy moduł NestJS posiada własne tabele i typy. Zero cross-module DB access.

| Moduł | Tabele (SQLite) | @kalio/types | Filesystem |
|---|---|---|---|
| `PersonaModule` | `personas`, `persona_kv` | `Persona`, `PersonaKV`, `PersonaSessionConfig` | — |
| `ChatModule` | `sessions`, `messages` | `ChatMessage`, `ChatSession`, `LLMMessage` | — |
| `LLMModule` | — | `LLMConfig`, `LLMStreamChunk`, `LLMToolCall` | — |
| `CredentialsModule` | `credentials` | `Credential`, `CreateCredentialDto` | — |
| `ToolModule` | — | `ToolMeta`, `ToolCallRequest`, `ToolResult`, `ToolConfirmationRequest` | — |
| `VFSModule` | — | `VFSFile`, `VFSWriteRequest`, `VFSReadResult` | `{WORKSPACE_ROOT}/conversations/{id}/files/` |
| `MCPModule` | `mcp_servers` | `MCPServer`, `MCPTool` | — |
| `RAAppModule` | — | `RAAppBlock`, `RAAppResult`, `RAAppAction` | VFS (read) |

---

## 4. Env Schema

> Plik: `apps/kalio-api/src/config/env.schema.ts`

```typescript
import Joi from 'joi';

export const envSchema = Joi.object({
  PORT:            Joi.number().default(3015),
  NODE_ENV:        Joi.string().valid('development', 'test', 'production').default('development'),
  DATABASE_PATH:   Joi.string().required(),
  WORKSPACE_ROOT:  Joi.string().required(),
  LLM_API_KEY:     Joi.string().when('NODE_ENV', { is: 'test', then: Joi.optional(), otherwise: Joi.required() }),
  LLM_BASE_URL:    Joi.string().when('NODE_ENV', { is: 'test', then: Joi.optional(), otherwise: Joi.required() }),
  LLM_MODEL:       Joi.string().when('NODE_ENV', { is: 'test', then: Joi.optional(), otherwise: Joi.required() }),
}).unknown(true);

// TEST_MODE=true activates MockLLMProvider — never requires LLM vars
```

---

## 5. Przepływy (opisy)

### 5.1 LLM Chat Streaming

```
FE: ChatInput.send(content)
  → socket.emit('chat:send', { sessionId, content, personaId, conversationId })
BE: ChatGateway.handleChatSend()
  → PersonaModule.getSessionConfig(personaId) → { systemPrompt, model, skills }
  → ChatModule.addMessage(sessionId, 'user', content)
  → LLMService.streamComplete(messages, onChunk, onComplete)
    → Provider.stream() [CometAPI / Ollama / Mock]
    → onChunk: socket.emit('chat:chunk', { delta, sessionId, messageId })
    → onComplete: 
        if (toolCall) → ToolModule.handleToolCall()
        else → ChatModule.addMessage(sessionId, 'assistant', fullContent)
              → socket.emit('chat:complete')
FE: ChatStore.handleChunk(chunk) → MessageBubble renders delta
FE: ChatStore.handleComplete() → message.streaming = false
```

### 5.2 Tool Execution (auto)

```
BE: ToolModule.dispatch({ toolName, args, callId })
  → ToolRegistry.find(toolName) → ToolMeta
  → if (!ToolMeta) → return { status:'error', errorCode:'TOOL_NOT_FOUND' }
  → if (!requiresConfirmation) → tool.execute(args)
  → socket.emit('tool:result', { callId, status:'success', data })
  → LLMService continues with tool_result in context
```

### 5.3 HITL Gate

```
BE: ToolModule.dispatch({ toolName:'vfs_delete', requiresConfirmation:true })
  → socket.emit('tool:confirmation_required', { requestId, toolName, args, timeoutMs:30000 })
  → PAUSE: await Promise with 30s timeout

FE: HITLDialog renders (toolName + args)
  User OK  → socket.emit('tool:confirm', { requestId })
  User Cancel → socket.emit('tool:cancel', { requestId })

BE: on 'tool:confirm' → resume → tool.execute() → socket.emit('tool:result')
    on 'tool:cancel'  → resolve({ status:'cancelled', errorCode:'TOOL_CANCELLED' })
    on timeout (30s)  → resolve({ status:'error', errorCode:'HITL_TIMEOUT' })
```

### 5.4 VFS Write

```
BE: VFSModule.write({ conversationId, filePath, content })
  → PathTraversalGuard.validate(conversationId, filePath)  ← FIRST, always
      if attack: throw new PathTraversalError('PATH_TRAVERSAL_DENIED')
  → resolvedPath = WORKSPACE_ROOT/conversations/{id}/files/{filePath}
  → fs.mkdir(dirname(resolvedPath), { recursive: true })
  → fs.writeFile(resolvedPath, content, 'utf8')
  → return { status:'success' }
```

### 5.5 Persona Session Init

```
BE: ChatGateway receives 'chat:send' with personaId
  → PersonaModule.getSessionConfig(personaId)
    → SELECT persona + persona_kv WHERE personaId
    → return { systemPrompt, model, skills, kv }
  → LLMService.setSystemPrompt(systemPrompt)
  → ToolRegistry.setAllowedSkills(skills)  ← filters available tools for session
  → proceed with LLM call
```

---

## 6. @kalio/sdk — FE client

> Plik: `packages/@kalio/sdk/src/index.ts`
> Thin wrapper around Socket.IO — BE-aware event types.

```typescript
import { io, Socket } from 'socket.io-client';
import type { SocketEvents } from '@kalio/types';

export class KalioClient {
  private socket: Socket;

  constructor(url: string) {
    this.socket = io(url, { transports: ['websocket'] });
  }

  sendMessage(payload: SocketEvents['chat:send']) {
    this.socket.emit('chat:send', payload);
  }

  onChunk(cb: (chunk: SocketEvents['chat:chunk']) => void) {
    this.socket.on('chat:chunk', cb);
    return () => this.socket.off('chat:chunk', cb);
  }

  onComplete(cb: (data: SocketEvents['chat:complete']) => void) {
    this.socket.on('chat:complete', cb);
    return () => this.socket.off('chat:complete', cb);
  }

  onError(cb: (err: SocketEvents['chat:error']) => void) {
    this.socket.on('chat:error', cb);
    return () => this.socket.off('chat:error', cb);
  }

  onConfirmationRequired(cb: (req: SocketEvents['tool:confirmation_required']) => void) {
    this.socket.on('tool:confirmation_required', cb);
    return () => this.socket.off('tool:confirmation_required', cb);
  }

  confirmTool(payload: SocketEvents['tool:confirm']) {
    this.socket.emit('tool:confirm', payload);
  }

  cancelTool(payload: SocketEvents['tool:cancel']) {
    this.socket.emit('tool:cancel', payload);
  }

  disconnect() { this.socket.disconnect(); }
}
```
