// ─── @kalio/types — Single source of truth for all BE ↔ FE contracts ────────
// NEVER duplicate these types in apps. Import only from '@kalio/types'.

// ─── Core primitives ─────────────────────────────────────────────────────────
export type ID = string;          // nanoid() — 21 chars
export type Timestamp = number;   // Unix ms (Date.now())
export type ISOString = string;   // ISO 8601

// ─── LLM Layer ───────────────────────────────────────────────────────────────
export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

// Multimodal content parts (OpenAI-compatible).
// `image_url.url` is a data URL (`data:<mime>;base64,...`) so the same shape
// works without provider-specific upload steps.
export interface LLMTextPart { type: 'text'; text: string }
export interface LLMImagePart { type: 'image_url'; image_url: { url: string } }
export type LLMContent = string | Array<LLMTextPart | LLMImagePart>;

export interface LLMMessage {
  role: LLMRole;
  content: LLMContent;
  toolCallId?: string;  // for role='tool' responses
  name?: string;        // for role='tool' — tool name
  toolCalls?: LLMToolCall[];  // for role='assistant' with tool calls
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
  sessionId: ID;
  messageId: ID;
  /** True when delta carries reasoning/thinking content (not final answer) */
  thinking?: boolean;
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

// VFS-relative attachment reference (no bytes — bytes live in session VFS)
export interface ChatAttachment {
  path: string;       // relative to session VFS root, e.g. 'uploads/abc.png'
  mimeType: string;   // e.g. 'image/png'
}

export interface ChatMessage {
  id: ID;
  sessionId: ID;
  role: MessageRole;
  content: string;
  thinking?: string;          // reasoning content from models like MiMo / DeepSeek
  toolCalls?: LLMToolCall[];  // populated for assistant messages with tool use
  toolCallId?: string;        // populated for role='tool_result'
  attachments?: ChatAttachment[];  // image / file attachments on user messages
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
  toolCallId: string;         // the LLM tool call ID (matches ToolResult.callId)
  sessionId: ID;
  toolName: string;
  args: Record<string, unknown>;
  timeoutMs: number;          // default 30000
}

// ─── VFS ──────────────────────────────────────────────────────────────────────
export interface VFSFile {
  sessionId: ID;
  path: string;               // relative to sessions/{id}/files/
  sizeBytes: number;
  mimeType?: string;
  updatedAt: Timestamp;
}

export interface VFSWriteRequest {
  sessionId: ID;
  filePath: string;
  content: string;
}

export interface VFSReadResult {
  sessionId: ID;
  filePath: string;
  content: string;
}

export interface VFSListResult {
  sessionId: ID;
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

// ─── Allowed Paths ──────────────────────────────────────────────────────────────
export interface AllowedPath {
  id: ID;
  path: string;
  createdAt: Timestamp;
}

export interface CreateAllowedPathDto {
  path: string;
}

// ─── MCP ──────────────────────────────────────────────────────────────────────
export type MCPServerStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'stopped';

export interface MCPServer {
  id: ID;
  name: string;
  transport: 'stdio' | 'http';
  url?: string;
  command?: string;
  args?: string[];
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

export interface CreateMCPServerDto {
  name: string;
  transport: 'stdio' | 'http';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
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

// ─── MCP (extended) ───────────────────────────────────────────────────────────
export type MCPTransport = 'stdio' | 'http';

export interface MCPServerConfig {
  id: ID;
  name: string;
  transport: MCPTransport;
  enabled: boolean;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http
  url?: string;
  headers?: Record<string, string>;
}

// ─── Skills ───────────────────────────────────────────────────────────────────
export interface Skill {
  id: ID;
  name: string;
  description: string;
  prompt: string;               // injected into system prompt when skill is active
  source: 'user' | 'agent';     // agent = proposed by LLM via create_skill tool
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateSkillDto {
  name: string;
  description: string;
  prompt: string;
  source?: 'user' | 'agent';
}

export interface UpdateSkillDto {
  name?: string;
  description?: string;
  prompt?: string;
}

// ─── Agent Loops (Forever Loop) ───────────────────────────────────────────────
export type AgentLoopStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'error' | 'completed';
export type AgentTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type AgentLoopMode = 'continuous' | 'watchdog';

export interface AgentLoopConfig {
  maxIterations: number;          // default 100
  iterationDelayMs: number;       // delay between iterations, default 1000
  mode: AgentLoopMode;
  watchdogIntervalMs?: number;    // watchdog mode: interval to check for new tasks
  maxConsecutiveFailures?: number; // circuit breaker, default 5
}

export interface AgentLoop {
  id: ID;
  name: string;
  personaId: ID;                  // which persona drives this loop
  systemPrompt: string;
  status: AgentLoopStatus;
  config: AgentLoopConfig;
  currentTaskId?: ID;
  chatSessionId?: ID;             // optional: linked session for progress updates
  iterationCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AgentTask {
  id: ID;
  loopId: ID;
  title: string;
  description: string;
  priority: number;               // 0–10, higher = executed first
  status: AgentTaskStatus;
  resultSummary?: string;
  orderIndex: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AgentIteration {
  id: ID;
  loopId: ID;
  taskId?: ID;
  iterationNumber: number;
  action: 'execute_task' | 'pause' | 'resume' | 'error' | 'watchdog';
  promptUsed: string;
  resultSummary: string;
  durationMs: number;
  createdAt: Timestamp;
}

export interface CreateAgentLoopDto {
  name: string;
  personaId: ID;
  systemPrompt?: string;
  mode?: AgentLoopMode;
  watchdogIntervalMinutes?: number;
  maxIterations?: number;
}

export interface CreateAgentTaskDto {
  loopId: ID;
  title: string;
  description?: string;
  priority?: number;
}

// ─── Socket.IO Event Map ──────────────────────────────────────────────────────
// COMPLETE contract between FE and BE. All Socket.IO events defined here.
export interface SocketEvents {
  // Chat — client → server
  'chat:send': { sessionId: ID; content: string; personaId: ID; interrupt?: boolean; attachments?: ChatAttachment[] };

  // Server -> client ack when a chat:send arrives during an active turn and is enqueued.
  // The FE can use this to render a "queued (n)" badge.
  'chat:queued': { sessionId: ID; queueLength: number; position: number };

  // Chat — server → client
  'chat:context': { sessionId: ID; systemPrompt: string; toolNames: string[] };
  'chat:chunk': LLMStreamChunk;
  'chat:complete': {
    sessionId: ID;
    messageId: ID;
    usage?: { promptTokens: number; completionTokens: number };
  };
  'chat:error': {
    sessionId: ID;
    code: 'PROVIDER_NOT_CONFIGURED' | 'LLM_ERROR' | 'TOOL_ERROR' | 'INTERRUPTED' | 'QUEUE_FULL' | 'MAX_ITERATIONS_REACHED';
    message: string;
  };

  // Tool HITL — server → client
  'tool:confirmation_required': ToolConfirmationRequest;

  // Tool HITL — client → server
  'tool:confirm': { requestId: string; sessionId: ID };
  'tool:cancel': { requestId: string; sessionId: ID };

  // Tool execution lifecycle — server → client
  'tool:start': { callId: ID; toolName: string; args: Record<string, unknown> };

  // Tool result — server → client
  'tool:result': ToolResult;

  // Agent loop lifecycle — server → client
  'agent:start': { sessionId: ID; turnId: ID };
  'agent:done': { sessionId: ID; turnId: ID };

  // MCP — server → client
  'mcp:server:status': { serverId: ID; serverName: string; status: string; toolCount: number; lastError?: string };
  'mcp:connected': { serverId: ID; serverName: string; toolCount: number };
  'mcp:disconnected': { serverId: ID; reason: string };
  'mcp:error': { serverId: ID; error: string };

  // Agent Loops — server → client
  'agentLoop:stateChange': { loopId: ID; status: AgentLoopStatus; iterationCount?: number };
  'agentLoop:taskStarted': { loopId: ID; taskId: ID };
  'agentLoop:taskDone': { loopId: ID; taskId: ID; resultSummary: string };
  'agentLoop:taskProgress': { loopId: ID; taskId?: ID; delta: string };
  'agentLoop:error': { loopId: ID; taskId?: ID; error: string };
  'agentLoop:idle': { loopId: ID; message: string };
  'agentLoop:watchdog': { loopId: ID; message: string };
  'agentLoop:complete': { loopId: ID; totalIterations: number };

  // Agent Loops — client → server
  'agentLoop:start': { loopId: ID };
  'agentLoop:pause': { loopId: ID };
  'agentLoop:stop': { loopId: ID };
  'agentLoop:addTask': CreateAgentTaskDto;

  // Sessions — server → client
  'session:created': ChatSession;
  'session:updated': Pick<ChatSession, 'id' | 'title' | 'updatedAt'>;

  // Memory — client → server
  'memory:ingest': { text: string; personaId: ID; metadata?: Record<string, string> };
  'memory:ingestConversation': { messages: Array<{ role: string; content: string }>; personaId: ID };
  'memory:search': { query: string; personaId: ID; limit?: number; mode?: MemorySearchMode };

  // Memory — server → client
  'memory:ingested': { ids: string[]; count: number };
  'memory:results': { results: MemorySearchResult[]; mode: MemorySearchMode };
}

// ─── Memory (Hybrid: Vector + BM25) ─────────────────────────────────────────
export type MemorySearchMode = 'vector' | 'fts' | 'hybrid';

export interface MemoryIngestResult {
  ids: string[];
  count: number;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, string>;
  createdAt: number;
}

export interface MemoryIngestRequest {
  text: string;
  personaId: ID;
  metadata?: Record<string, string>;
}

export interface MemoryConversationIngestRequest {
  messages: Array<{ role: string; content: string }>;
  personaId: ID;
}

export interface MemorySearchRequest {
  query: string;
  personaId: ID;
  limit?: number;
  mode?: MemorySearchMode;
}

export interface EmbeddingStatus {
  provider: 'openai-compatible' | 'ollama';
  model: string;
  dimensions: number;
  baseUrlMasked: string;
  configured: boolean;
}
