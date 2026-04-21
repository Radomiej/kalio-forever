// ─── @kalio/types — Single source of truth for all BE ↔ FE contracts ────────
// NEVER duplicate these types in apps. Import only from '@kalio/types'.

// ─── Core primitives ─────────────────────────────────────────────────────────
export type ID = string;          // nanoid() — 21 chars
export type Timestamp = number;   // Unix ms (Date.now())
export type ISOString = string;   // ISO 8601

// ─── LLM Layer ───────────────────────────────────────────────────────────────
export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMMessage {
  role: LLMRole;
  content: string;
  toolCallId?: string;  // for role='tool' responses
  name?: string;        // for role='tool' — tool name
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
  sessionId: ID;
  messageId: ID;
}

export interface LLMToolCall {
  id: string;           // tool_call_id from provider
  name: string;
  args: Record<string, unknown>;
}

export interface LLMConfig {
  provider: LLMProviderType;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export type LLMProviderType = 'openai' | 'openrouter' | 'cometapi' | 'xiaomimimo' | 'ollama' | 'mock';

// ─── Persona ──────────────────────────────────────────────────────────────────
export interface Persona {
  id: ID;
  name: string;
  systemPrompt: string;
  model: string;        // e.g. "claude-sonnet-4-6", "gpt-4o", "qwen3:8b"
  skills: string[];     // tool names available to this persona
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PersonaKV {
  id: ID;
  personaId: ID;
  key: string;
  value: string;        // JSON-serializable string
  updatedAt: Timestamp;
}

export interface PersonaSessionConfig {
  systemPrompt: string;
  model: string;
  availableSkills: string[];    // filtered tool list for this session
  kv: Record<string, string>;   // all KV entries for this persona
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

// ─── Session / Chat ───────────────────────────────────────────────────────────
export type MessageRole = 'user' | 'assistant' | 'tool_result' | 'system';

export interface ChatMessage {
  id: ID;
  sessionId: ID;
  role: MessageRole;
  content: string;
  toolCalls?: LLMToolCall[];  // populated for assistant messages with tool use
  toolCallId?: string;        // populated for role='tool_result'
  streaming?: boolean;        // FE only — true while chunk stream is open
  createdAt: Timestamp;
}

export interface ChatSession {
  id: ID;
  personaId: ID;
  title: string;              // auto-generated from first message
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateSessionDto {
  personaId: ID;
  title?: string;
}

// ─── Tools ────────────────────────────────────────────────────────────────────
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
  callId: string;             // matches LLMToolCall.id
}

export interface ToolResult {
  callId: string;
  status: 'success' | 'error' | 'cancelled';
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export interface ToolConfirmationRequest {
  requestId: string;          // unique per confirmation instance
  sessionId: ID;
  toolName: string;
  args: Record<string, unknown>;
  timeoutMs: number;          // default 30000
}

// ─── VFS ──────────────────────────────────────────────────────────────────────
export interface VFSFile {
  conversationId: ID;
  path: string;               // relative to conversations/{id}/files/
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

// ─── Credentials ──────────────────────────────────────────────────────────────
// NOTE: apiKey is NEVER included in Credential — never exposed after creation.
export interface Credential {
  id: ID;
  name: string;
  provider: string;           // e.g. "CometAPI", "OpenRouter", "Ollama"
  baseUrl?: string;
  model?: string;
  createdAt: Timestamp;
}

export interface CreateCredentialDto {
  name: string;
  provider: string;
  apiKey: string;             // write-only, never returned
  baseUrl?: string;
  model?: string;
}

// ─── MCP ──────────────────────────────────────────────────────────────────────
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
  name: string;               // namespaced: "{serverId}::{toolName}"
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
  tool: string;               // tool name to call
  args: Record<string, unknown>;
  requiresConfirmation?: boolean;  // inherits from tool if not set
}

export interface RAAppBlock {
  type: RAAppType;
  mode: RAAppMode;
  content: string;            // HTML string or GUI DSL YAML
  vfsPath?: string;           // optional: load content from VFS path
  actions?: RAAppAction[];    // only for mode='interactive'
}

export interface RAAppResult {
  status: 'ready' | 'error';
  renderedContent?: string;
  error?: {
    code: 'DSL_PARSE_ERROR' | 'DSL_EXEC_ERROR' | 'SANDBOX_ERROR';
    message: string;
    line?: number;
  };
  requiresHITL?: boolean;     // true when mode='interactive' and has actions
}

// ─── Socket.IO Event Map ──────────────────────────────────────────────────────
// COMPLETE contract between FE and BE. All Socket.IO events defined here.
export interface SocketEvents {
  // Chat — client → server
  'chat:send': { sessionId: ID; content: string; personaId: ID; conversationId: ID };

  // Chat — server → client
  'chat:chunk': LLMStreamChunk;
  'chat:complete': {
    sessionId: ID;
    messageId: ID;
    usage?: { promptTokens: number; completionTokens: number };
  };
  'chat:error': {
    sessionId: ID;
    code: 'PROVIDER_NOT_CONFIGURED' | 'LLM_ERROR' | 'TOOL_ERROR';
    message: string;
  };

  // Tool HITL — server → client
  'tool:confirmation_required': ToolConfirmationRequest;

  // Tool HITL — client → server
  'tool:confirm': { requestId: string; sessionId: ID };
  'tool:cancel': { requestId: string; sessionId: ID };

  // Tool result — server → client
  'tool:result': ToolResult;

  // MCP — server → client
  'mcp:connected': { serverId: ID; serverName: string; toolCount: number };
  'mcp:disconnected': { serverId: ID; reason: string };
  'mcp:error': { serverId: ID; error: string };

  // Sessions — server → client
  'session:created': ChatSession;
  'session:updated': Pick<ChatSession, 'id' | 'title' | 'updatedAt'>;
}
