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
  agentRun?: AgentRunContext;
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

export type LLMProviderType =
  | 'openai'
  | 'openrouter'
  | 'cometapi'
  | 'xiaomimimo'
  | 'ollama'
  | 'deepseek'
  | 'bitnet'
  | 'custom'
  | 'mock';

// ─── Persona ──────────────────────────────────────────────────────────────────
/** Controls which MCP tools a persona can access. */
export type MCPPolicy = 'allow_all' | 'deny_all' | 'allow_list';

export interface Persona {
  id: ID;
  name: string;
  systemPrompt: string;
  model: string;           // e.g. "claude-sonnet-4-6", "gpt-4o", "qwen3:8b"
  allowedTools: string[];  // native tool names available to this persona (tool allowlist)
  skillIds: string[];      // IDs of Skill entities whose prompts are injected into system prompt
  mcpPolicy: MCPPolicy;    // how MCP tools are filtered for this persona
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
  allowedTools: string[];  // filtered tool list for this session
  skillIds: string[];      // Skill entity IDs whose prompts get injected
  mcpPolicy: MCPPolicy;    // how MCP tools are filtered for this session
  kv: Record<string, string>; // all KV entries for this persona
}

export interface CreatePersonaDto {
  name: string;
  systemPrompt: string;
  model: string;
  allowedTools: string[];
  skillIds?: string[];
  mcpPolicy?: MCPPolicy;
}

export interface UpdatePersonaDto {
  name?: string;
  systemPrompt?: string;
  model?: string;
  allowedTools?: string[];
  skillIds?: string[];
  mcpPolicy?: MCPPolicy;
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
  kind?: 'chat' | 'subagent';
  parentSessionId?: ID;
  parentTurnId?: ID;
  parentToolCallId?: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateSessionDto {
  personaId: ID;
  title?: string;
  kind?: 'chat' | 'subagent';
  parentSessionId?: ID;
  parentTurnId?: ID;
  parentToolCallId?: ID;
}

// ─── Tools ────────────────────────────────────────────────────────────────────
export interface ToolMeta {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  requiresConfirmation: boolean;        // HITL gate flag
}

export type AgentType = 'master' | 'subagent';
export type VFSMode = 'isolated' | 'shared';

export interface AgentRunContext {
  agentRunId: ID;
  agentType: AgentType;
  parentSessionId?: ID;
  parentTurnId?: ID;
  parentToolCallId?: ID;
  vfsMode?: VFSMode;
  vfsSessionId?: ID;
  label?: string;
  autoApproveTools?: string[];
  subagentDepth?: number;
}

export interface SubagentCopiedFile {
  fromPath: string;
  toPath: string;
  sizeBytes: number;
}

export interface SubagentToolResult {
  result: string;
  taskId: string;
  childSessionId: ID;
  parentSessionId: ID;
  vfsMode: VFSMode;
  vfsSessionId: ID;
  copiedFiles: SubagentCopiedFile[];
  durationMs: number;
}

export interface ToolCallRequest {
  sessionId: ID;
  vfsSessionId?: ID;
  toolName: string;
  args: Record<string, unknown>;
  callId: string;             // matches LLMToolCall.id
  availableTools?: ToolMeta[]; // persona-filtered set visible to the agent
  agentRun?: AgentRunContext;
  /**
   * Backend-only: typed emitter scoped to the originating socket client.
   * Set by ToolDispatchService from StreamContext. Never serialized to wire.
   * Tools that need real-time streaming (e.g. run_cli_agent) use this to push
   * progress events before the final tool:result arrives.
   */
  readonly _emit?: <K extends keyof SocketEvents>(event: K, data: SocketEvents[K]) => void;
}

export interface ToolResult {
  callId: string;
  status: 'success' | 'error' | 'cancelled';
  sessionId?: ID;
  toolName?: string;
  agentRun?: AgentRunContext;
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
  timeoutMs: number;          // confirmation timeout in ms; 0 disables timeout
  agentRun?: AgentRunContext;
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
  apiKey?: string;            // write-only, never returned; optional for local providers/endpoints
  baseUrl?: string;
  model?: string;
}

export interface ToolTimeoutSettings {
  webSearchTimeoutMs: number;
  providerLocalTimeoutMs: number;
  providerRemoteTimeoutMs: number;
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
  name: string;               // runtime name: "mcp_<serverId>_<toolName>"
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

// A single pending call_native approval surfaced to the frontend
export interface RaAppPendingApproval {
  id: string;                           // unique per approval request
  system: string;                       // native system ID (e.g. "vfs_write")
  displayLabel: string;                 // human-readable description
  args: Record<string, unknown>;        // resolved args to be executed on approval
}

// Native execution result pushed back to FE after approve/cancel
export interface RaAppNativeResult {
  id: string;                           // matches RaAppPendingApproval.id
  system: string;
  status: 'executed' | 'cancelled' | 'error';
  result?: unknown;
  error?: string;
}

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
  pendingApprovals?: RaAppPendingApproval[];  // populated when call_native needs HITL
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
  pendingApprovals?: RaAppPendingApproval[];  // populated by EffectsProcessorService
}

// ─── GUI DSL (rendered wire format) ─────────────────────────────────────────
// Subset of the internal AST that crosses the wire as JSON (BE → FE).
// The full parser AST (with richer block/statement types) lives in
// apps/kalio-api/src/modules/raapp/gui/guiDslAst.ts — do NOT import from there.
export interface GuiString     { kind: 'string';     value: string  }
export interface GuiNumber     { kind: 'number';     value: number  }
export interface GuiBoolean    { kind: 'boolean';    value: boolean }
export interface GuiIdentifier { kind: 'identifier'; value: string  }
export interface GuiFunctionCall { kind: 'function'; name: string; args: GuiScalar[] }
export type GuiScalar = GuiString | GuiNumber | GuiBoolean | GuiIdentifier | GuiFunctionCall;
export interface GuiBlock      { kind: 'block'; items: unknown[] }  // opaque in wire format
export type GuiValue = GuiScalar | GuiBlock;
export interface GuiElementNode {
  kind: 'element';
  tag: string;
  props: Record<string, GuiValue>;
  children: GuiNode[];
}
export interface GuiBlockNode {
  kind: 'block_node';
  mode: 'block' | 'blockoverride';
  name: string;
  props: Record<string, GuiValue>;
  children: GuiNode[];
}
export type GuiNode = GuiElementNode | GuiBlockNode;
export interface GuiDslPayload {
  nodes: GuiNode[];
  data: Record<string, unknown>;
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

// ─── Socket.IO Event Map ──────────────────────────────────────────────────────
// COMPLETE contract between FE and BE. All Socket.IO events defined here.
export interface SocketEvents {
  // Chat — client → server
  'chat:send': { sessionId: ID; content: string; personaId: ID; interrupt?: boolean; attachments?: ChatAttachment[] };
  /** Client requests immediate abort of the active agent loop for sessionId. No new turn is started. */
  'chat:stop': { sessionId: ID };

  // Server -> client ack when a chat:send arrives during an active turn and is enqueued.
  // The FE can use this to render a "queued (n)" badge.
  'chat:queued': { sessionId: ID; queueLength: number; position: number };

  // Chat — server → client
  'chat:context': { sessionId: ID; systemPrompt: string; toolNames: string[] };
  'chat:chunk': LLMStreamChunk;
  'chat:complete': {
    sessionId: ID;
    messageId: ID;
    agentRun?: AgentRunContext;
    usage?: { promptTokens: number; completionTokens: number };
  };
  'chat:error': {
    sessionId: ID;
    code: 'PROVIDER_NOT_CONFIGURED' | 'LLM_ERROR' | 'TOOL_ERROR' | 'INTERRUPTED' | 'QUEUE_FULL' | 'MAX_ITERATIONS_REACHED';
    message: string;
    agentRun?: AgentRunContext;
    /** True if at least one `chat:chunk` was emitted before this error.
     *  FE uses this to decide whether to append the error to the existing
     *  response bubble (true) or roll back the empty bubble and show a
     *  retry banner (false). */
    hadContent: boolean;
  };

  // Tool HITL — server → client
  'tool:confirmation_required': ToolConfirmationRequest;

  // Tool HITL — client → server
  'tool:confirm': { requestId: string; sessionId: ID };
  'tool:cancel': { requestId: string; sessionId: ID };

  // Tool execution lifecycle — server → client
  'tool:start': { callId: ID; toolName: string; args: Record<string, unknown>; sessionId?: ID; agentRun?: AgentRunContext };

  // Tool result — server → client
  'tool:result': ToolResult;

  // RA-App HITL — client → server
  'raapp:approve': { requestIds: string[]; sessionId: ID };
  'raapp:cancel':  { requestIds: string[]; sessionId: ID };

  // RA-App HITL — server → client (result after approve/cancel)
  'raapp:native_result': { toolCallId: string; sessionId: ID; results: RaAppNativeResult[] };

  // Agent loop lifecycle — server → client
  'agent:start': { sessionId: ID; turnId: ID; agentRun?: AgentRunContext };
  'agent:done': { sessionId: ID; turnId: ID; agentRun?: AgentRunContext };

  // MCP — server → client
  'mcp:server:status': { serverId: ID; serverName: string; status: string; toolCount: number; lastError?: string };
  'mcp:connected': { serverId: ID; serverName: string; toolCount: number };
  'mcp:disconnected': { serverId: ID; reason: string };
  'mcp:error': { serverId: ID; error: string };

  // Sessions — server → client
  'session:created': ChatSession;
  'session:updated': Pick<ChatSession, 'id' | 'title' | 'updatedAt'>;

  // Session re-registration — client → server (sent after reconnect)
  'session:identify': { sessionId: ID };

  // CLI Agent streaming — server → client
  'cli_agent:progress': { callId: ID; sessionId: ID; agentId: string; chunk: string };

}

// ─── CLI Agent ────────────────────────────────────────────────────────────────
/** Result returned by the run_cli_agent tool after a CLI agent run completes. */
export interface CLIAgentResult {
  output: string;       // combined stdout+stderr from the CLI process (possibly compressed)
  exitCode: number;     // 0 = success, non-zero = failure
  durationMs: number;   // wall-clock time of the CLI run
  agentId: string;      // which adapter was used: 'copilot' | 'gemini' | 'claude' | …
}

/** Probe/availability info for a single CLI agent adapter. */
export interface CLIAgentAdapterInfo {
  id: string;
  displayName: string;
  installUrl: string;
  available: boolean;
  version: string | null;
}

/** Per-adapter configuration stored at ~/.kalio/cli-agents/{id}.json */
export interface CLIAgentConfig {
  /** Whether this agent is enabled. Default: true. */
  enabled: boolean;
  /** Override the executable path/name. Empty string = use adapter default. */
  cliPath: string;
  /** Max execution time in ms. Default: 600 000 (10 min). */
  timeoutMs: number;
  /** Max output chars kept for LLM history. Default: 16 000. */
  maxOutputChars: number;
  /** Extra CLI args appended after the adapter's default args. */
  extraArgs: string[];
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

// ─── Embedding Credentials ───────────────────────────────────────────────────
// Independent credential table for embedding providers (separate from LLM
// credentials — embedding has `dimensions` and different provider set).
export type EmbeddingProviderType = 'openai' | 'cometapi' | 'openrouter' | 'ollama' | 'custom';

/** apiKey is NEVER included in EmbeddingCredential — never exposed after creation. */
export interface EmbeddingCredential {
  id: ID;
  name: string;
  provider: EmbeddingProviderType;
  baseUrl: string;
  model: string;
  dimensions: number;
  createdAt: Timestamp;
}

export interface CreateEmbeddingCredentialDto {
  name: string;
  provider: EmbeddingProviderType;
  apiKey: string;          // write-only, never returned
  baseUrl: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingStatus {
  provider: 'openai-compatible' | 'ollama' | 'mock';
  /** Where the active embedding config comes from */
  source: 'db' | 'env' | 'mock';
  model: string;
  dimensions: number;
  baseUrlMasked: string;
  configured: boolean;
  /** Set when source === 'db' */
  activeCredentialId?: string;
  activeCredentialName?: string;
}

// ─── RA-App Catalog (stored apps — distinct from inline raapp_create results) ─
// These types cross the BE↔FE boundary for the versioned app catalog.

export interface RAAppSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  expose_as_tool: boolean;
  tool_description: string;
  source: 'core' | 'user';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RAAppVersionInfo {
  version: string;
  meta: RAAppMetaSummary;
  status: 'current' | 'draft' | 'archived';
  zipPath: string;
  createdAt: Timestamp;
  approvedAt?: Timestamp;
}

/** Subset of meta.yml fields needed by the UI — not the full internal type. */
export interface RAAppMetaSummary {
  id: string;
  name: string;
  version: string;
  description?: string;
  tags?: string[];
  expose_as_tool?: boolean;
  tool_description?: string;
}

export interface RAAppGroup {
  slug: string;
  name: string;
  source: 'core' | 'user';
  current: RAAppVersionInfo;
  draft?: RAAppVersionInfo;
  history: RAAppVersionInfo[];
}

// ─── Audit Log ───────────────────────────────────────────────────────────────
// Shared between the audit-log controller (GET /api/audit-log response) and
// the observability UI. AuditType is also used by AuditService internally.
export type AuditType =
  | 'llm_request'
  | 'llm_response'
  | 'tool_call'
  | 'tool_result'
  | 'error'
  | 'raapp_native_call'
  | 'raapp_native_approved';

export interface AuditLogEntry {
  id: ID;
  sessionId: string | null;
  type: AuditType;
  label: string;
  data: Record<string, unknown> | null;
  durationMs: number | null;
  chunkCount: number | null;
  createdAt: Timestamp;
}

// ─── Image Generation ─────────────────────────────────────────────────────────
export type ImageRefRole = 'character' | 'object' | 'style' | 'background' | 'base';

export interface ImageRef {
  vfsPath: string;
  role: ImageRefRole;
  label: string;
}

export type ImageDetail = 'low' | 'auto' | 'high';

export interface ImageCompressionConfig {
  enabled: boolean;
  maxDimension: number;   // px, e.g. 1024
  maxKb: number;          // max file size in KB, e.g. 512
  detail: ImageDetail;
}

export type ImageProviderType = 'cometapi' | 'openai' | 'openrouter' | 'replicate' | 'auto';

export interface ImageProviderConfig {
  provider: ImageProviderType;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  compression?: ImageCompressionConfig;
}

export interface ImageConfigResponse {
  provider: ImageProviderType;
  baseUrl?: string;
  model?: string;
  compression?: ImageCompressionConfig;
  source: 'db' | 'default';
}

export interface UpdateImageConfigDto {
  provider?: ImageProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  compression?: ImageCompressionConfig;
}

export interface ImageGenerateResult {
  image_url: string;    // base64 data URL
  path: string;         // VFS path where saved
  model: string;
  size: string;
  format: string;
  download_url: string;
  message: string;
}

export interface ImageEditResult {
  image_url: string;
  path: string;
  model: string;
  refCount: number;
  durationMs: number;
  download_url: string;
  message: string;
  iteratedFrom?: string;
}
