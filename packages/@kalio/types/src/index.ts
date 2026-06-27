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

export type ContextCompactionStrategy = 'backend-default' | 'summary' | 'evidence_only';

export type SessionRuntimeKind = 'chat' | 'subagent' | 'agent-flow-branch' | 'cli-agent' | 'agent-flow-root';
export type SystemPromptProfile = 'default-chat' | 'subagent' | 'agent-flow-branch';
export type RuntimeProfileSource = 'session' | 'request' | 'persona-default';

export type ToolPolicyProfile = 'default-chat' | 'subagent' | 'agent-flow-branch' | 'agent-flow-root' | 'cli-agent';

export type ToolDenyReason =
  | 'not_in_persona_allowlist'
  | 'not_in_runtime_explicit_list'
  | 'slot_policy_denied'
  | 'missing_project_path'
  | 'missing_execution_cwd'
  | 'cli_unavailable'
  | 'requires_confirmation'
  | 'subagent_depth_limit';

export type ToolPolicySource = 'persona' | 'runtime-explicit' | 'architecture-slot-policy' | 'merged';

export interface ToolPolicyDeniedTool {
  name: string;
  reason: ToolDenyReason;
}

export interface ToolPolicyDecision {
  tools: ToolMeta[];
  source: ToolPolicySource;
  allowedToolNames: string[];
  denied: ToolPolicyDeniedTool[];
  warnings: string[];
}

export interface ArchitectureSlotToolPolicy {
  allowedToolNames: string[];
  stripRequiresConfirmation?: boolean;
  applyCliDescriptionPreferences?: boolean;
}

export type WorkflowSessionSurface = 'host-envelope' | 'conversation-branch' | 'technical-node';
export type WorkflowConversationVisibility = 'visible' | 'hidden';

export interface ArchitectureRuntimeContext extends Record<string, unknown> {
  parentSessionId?: ID;
  parentToolCallId?: ID;
  architectureRunId?: ID;
  hostSessionId?: ID;
  historySessionId?: ID;
  sessionSurface?: WorkflowSessionSurface;
  conversationVisibility?: WorkflowConversationVisibility;
  schemaId?: string;
  schemaName?: string;
  displayLabel?: string;
  roleSlotId?: ID;
  roleSlotType?: string;
  roleLabel?: string;
  projectPath?: string;
  executionCwd?: string;
}

export function architectureSessionPrefixForRun(runId: ID): ID {
  const normalizedRunId = runId.trim();
  return normalizedRunId.startsWith('arch-') ? normalizedRunId : `arch-${normalizedRunId}`;
}

export function architectureSessionIdForRunSlot(runId: ID, slotOrNodeId: string | undefined): ID | undefined {
  const normalizedSlotOrNodeId = slotOrNodeId?.trim();
  if (!runId.trim() || !normalizedSlotOrNodeId) {
    return undefined;
  }
  return `${architectureSessionPrefixForRun(runId)}-${normalizedSlotOrNodeId}`;
}

export interface SessionRuntimeContext {
  runtimeKind: SessionRuntimeKind;
  parentSessionId?: ID;
  parentToolCallId?: ID;
  vfsMode?: VFSMode;
  vfsSessionId?: ID;
  modelOverride?: string;
  explicitToolNames?: string[];
  systemPromptProfile?: SystemPromptProfile;
  toolPolicyProfile?: ToolPolicyProfile;
  architectureSlotId?: ID;
  architectureSlotPolicy?: ArchitectureSlotToolPolicy;
  architectureContext?: ArchitectureRuntimeContext;
}

type ContextPreviewBase = {
  draftUserMessage?: string;
  attachments?: ChatAttachment[];
};

export type ContextPreviewRequest =
  | (ContextPreviewBase & {
      target?: 'session';
      sessionId: ID;
      personaId: ID;
      runtimeContext?: never;
    })
  | (ContextPreviewBase & {
      target: 'runtime';
      personaId: ID;
      runtimeContext: SessionRuntimeContext;
      sessionId?: never;
    });

export interface ContextPreviewMessage {
  role: LLMRole;
  content: LLMContent;
  reasoningContent?: string;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
  source: 'system_prompt' | 'history' | 'draft';
  estimatedTokens: number;
}

export interface LLMContextPreview {
  sessionId: ID;
  personaId: ID;
  model: string;
  contextLimit: number;
  estimatedTokens: {
    total: number;
    systemPrompt: number;
    tools: number;
    history: number;
    images: number;
    reasoning: number;
  };
  compaction: {
    applied: boolean;
    unboundedMessageCount: number;
    finalMessageCount: number;
    safeTargetTokens: number;
  };
  effectiveSystemPrompt: string;
  tools: ToolMeta[];
  messages: ContextPreviewMessage[];
  runtimeKind?: SessionRuntimeKind;
  runtimeProfileSource?: RuntimeProfileSource;
  warnings?: string[];
  toolPolicy?: ToolPolicyDecision;
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
  sessionId: ID;
  messageId: ID;
  agentRun?: AgentRunContext;
  /** True when delta carries reasoning/thinking content (not final answer) */
  thinking?: boolean;
  /** Provider-reported usage when available from a terminal stream chunk. */
  usage?: { promptTokens: number; completionTokens: number; totalTokens?: number };
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

/** Deterministic avatar variant persisted on Persona records. */
export type AvatarVariant = 'marble' | 'beam' | 'pixel' | 'sunset' | 'ring' | 'bauhaus';

/** Stable palette identifier; hex colors are resolved client-side from this key. */
export type AvatarPaletteKey = 'ocean' | 'sunset' | 'forest' | 'violet' | 'ember' | 'slate' | 'candy' | 'mono';

/** Persistent deterministic avatar token stored on Persona (no raw color arrays). */
export interface PersonaAvatarToken {
  avatarSeed: string;
  avatarVariant: AvatarVariant;
  avatarPaletteKey: AvatarPaletteKey;
  avatarIndex: number;
}

export interface Persona {
  id: ID;
  name: string;
  systemPrompt: string;
  model: string;           // e.g. "claude-sonnet-4-6", "gpt-4o", "qwen3:8b"
  maxToolAttempts?: number | null;
  allowedTools: string[];  // native tool names available to this persona (tool allowlist)
  skillIds: string[];      // IDs of Skill entities whose prompts are injected into system prompt
  mcpPolicy: MCPPolicy;    // how MCP tools are filtered for this persona
  avatarSeed: string;
  avatarVariant: AvatarVariant;
  avatarPaletteKey: AvatarPaletteKey;
  avatarIndex: number;
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
  maxToolAttempts?: number | null;
  allowedTools: string[];  // filtered tool list for this session
  skillIds: string[];      // Skill entity IDs whose prompts get injected
  mcpPolicy: MCPPolicy;    // how MCP tools are filtered for this session
  kv: Record<string, string>; // all KV entries for this persona
}

export interface CreatePersonaDto {
  name: string;
  systemPrompt: string;
  model: string;
  maxToolAttempts?: number;
  allowedTools: string[];
  skillIds?: string[];
  mcpPolicy?: MCPPolicy;
  avatarSeed?: string;
  avatarVariant?: AvatarVariant;
  avatarPaletteKey?: AvatarPaletteKey;
  avatarIndex?: number;
}

export interface UpdatePersonaDto {
  name?: string;
  systemPrompt?: string;
  model?: string;
  maxToolAttempts?: number | null;
  allowedTools?: string[];
  skillIds?: string[];
  mcpPolicy?: MCPPolicy;
  avatarSeed?: string;
  avatarVariant?: AvatarVariant;
  avatarPaletteKey?: AvatarPaletteKey;
  avatarIndex?: number;
}

// ─── Session / Chat ───────────────────────────────────────────────────────────
export type MessageRole = 'user' | 'assistant' | 'tool_result' | 'system';

// VFS-relative attachment reference (no bytes — bytes live in session VFS)
export interface ChatAttachment {
  path: string;       // relative to session VFS root, e.g. 'uploads/abc.png'
  mimeType: string;   // e.g. 'image/png'
}

export interface ArchitectureChatTraceStep {
  speaker: 'participant' | 'router' | 'finalizer';
  content: string;
  actionSummary?: string;
  action?: ArchitectureEventAction;
  detail?: string;
  eventId?: ID;
  sessionId?: ID;
  nodeId?: string;
  nextNodeId?: string;
  visitIndex?: number;
  incompleteReason?: string;
  routerOutput?: ArchitectureRouterOutput;
  stream?: ArchitectureBranchStreamSummary;
}

export interface ArchitectureBranchStreamSummary {
  streamGroupId: ID;
  branchSessionId: ID;
  status: 'started' | 'streaming' | 'completed' | 'failed';
  chunkCount: number;
  text: string;
}

export interface ArchitectureChatRunSummary {
  runId: ID;
  schemaId: ID;
  status: ArchitectureRunStatus;
  hostProjectionKind?: 'workflow-envelope';
  finalArtifact?: string;
  trace: ArchitectureChatTraceStep[];
  routeHops: ArchitectureRouteHop[];
}

export interface ChatMessage {
  id: ID;
  sessionId: ID;
  role: MessageRole;
  content: string;
  turnId?: ID;
  promptMessageId?: ID;
  thinking?: string;          // reasoning content from models like MiMo / DeepSeek
  toolCalls?: LLMToolCall[];  // populated for assistant messages with tool use
  toolCallId?: string;        // populated for role='tool_result'
  attachments?: ChatAttachment[];  // image / file attachments on user messages
  architectureRun?: ArchitectureChatRunSummary; // FE projection for architecture graph runs
  streaming?: boolean;        // FE only — true while chunk stream is open
  createdAt: Timestamp;
}

export type ChatSessionKind = 'chat' | 'subagent' | 'cli-agent' | 'agent-flow';

export interface ChatSession {
  id: ID;
  personaId: ID;
  title: string;              // auto-generated from first message
  kind?: ChatSessionKind;
  parentSessionId?: ID;
  parentTurnId?: ID;
  parentToolCallId?: ID;
  runtimeContext?: SessionRuntimeContext;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateSessionDto {
  personaId: ID;
  title?: string;
  kind?: ChatSessionKind;
  parentSessionId?: ID;
  parentTurnId?: ID;
  parentToolCallId?: ID;
  runtimeContext?: SessionRuntimeContext;
}

// ─── Tools ────────────────────────────────────────────────────────────────────
export interface ToolMeta {
  name: string;
  description: string;
  serverKey?: ID;               // canonical MCP server key when this tool originates from MCP
  parameters: Record<string, unknown>;  // JSON Schema
  requiresConfirmation: boolean;        // HITL gate flag
}

export type AgentType = 'master' | 'subagent';
export type VFSMode = 'isolated' | 'shared';
export type ChildExecutionKind = 'sub_agent' | 'cli_agent' | 'sub_agentflow';
export type ArchitectureChildAgentKind = ChildExecutionKind | 'subagent' | 'cli-agent';
export type AgentFlowRunStatus = 'queued' | 'running' | 'waiting_on_orchestrator' | 'done' | 'failed' | 'cancelled' | 'blocked';
export type AgentFlowReturnMode = 'summary' | 'full_trace' | 'artifacts_only';
export type AgentFlowStartMode = 'durable' | 'blocking';
export type AgentFlowPhase = 'strategy' | 'research' | 'debate' | 'build' | 'qa' | 'hitl' | 'custom';

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

export interface RunSubAgentFlowArgs {
  flowId: ID;
  goal: string;
  context?: string | Record<string, unknown>;
  parentSessionId: ID;
  parentToolCallId?: ID;
  startMode?: AgentFlowStartMode;
  vfsMode?: VFSMode;
  copyBack?: boolean;
  returnMode?: AgentFlowReturnMode;
  maxSteps?: number;
  continuation?: AgentFlowContinuationCursor;
}

export interface AgentFlowNode {
  id: ID;
  agentId: ID;
  label: string;
  phase: AgentFlowPhase;
  role: string;
  tools: string[];
  x?: number;
  y?: number;
}

export interface AgentFlowEdge {
  id: ID;
  fromNodeId: ID;
  toNodeId: ID;
  condition?: string;
  returnToOrchestrator?: boolean;
}

export interface AgentFlowDefinition {
  id: ID;
  name: string;
  version: string;
  entryNodeId: ID;
  orchestratorNodeId?: ID;
  maxIterations?: number;
  nodes: AgentFlowNode[];
  edges: AgentFlowEdge[];
}

export interface AgentFlowTraceItem {
  id: ID;
  sequence: number;
  type: string;
  lifecycle?: AgentFlowLifecycleEvent;
  message: string;
  nodeId?: string;
  roleSlotId?: string;
  route?: ArchitectureRouteDecision;
  data?: Record<string, unknown>;
  status?: AgentFlowRunStatus;
  createdAt: Timestamp;
}

export type AgentFlowLifecycleEvent =
  | 'started'
  | 'node_started'
  | 'node_completed'
  | 'edge_taken'
  | 'guard_result'
  | 'tool_called'
  | 'return_to_orchestrator'
  | 'waiting_on_orchestrator'
  | 'resume_input'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'runtime_missing'
  | 'runtime_stalled'
  | 'copy_back';

export interface SubAgentFlowResult {
  flowRunId: ID;
  parentSessionId?: ID;
  parentToolCallId?: ID;
  childSessionId: ID;
  status: AgentFlowRunStatus;
  summary: string;
  decisions: string[];
  nextActions: string[];
  artifacts: string[];
  returnToOrchestratorCount?: number;
  tracePreview?: AgentFlowTraceItem[];
  openChatSessionId?: ID;
  openGraphRunId?: ID;
}

export interface AgentFlowRouteCheckpoint {
  fromNodeId: ID;
  selectedNodeIds: ID[];
  nextNodeId?: ID;
  source?: ArchitectureRouteSource;
  response?: string;
}

export interface AgentFlowContinuationCursor {
  reason: 'max_steps' | 'return_to_orchestrator' | 'runtime_pause';
  waitingNodeId?: ID;
  pendingNodeIds: ID[];
  visitCounts: Record<ID, number>;
  lastCompletedNodeId?: ID;
  lastRoute?: AgentFlowRouteCheckpoint;
  message?: string;
}

export interface AgentFlowCheckpoint {
  goal: string;
  context?: string | Record<string, unknown>;
  vfsMode?: VFSMode;
  copyBack?: boolean;
  maxSteps?: number;
  continuation?: AgentFlowContinuationCursor;
  lastResumeInput?: string;
  resumeContext?: Record<string, unknown>;
}

export interface AgentFlowRun {
  id: ID;
  parentSessionId: ID;
  parentToolCallId?: ID;
  childSessionId: ID;
  openChatSessionId?: ID;
  openGraphRunId?: ID;
  flowDefinitionId: ID;
  status: AgentFlowRunStatus;
  startMode: AgentFlowStartMode;
  returnMode: AgentFlowReturnMode;
  activeNodeIds?: ID[];
  completedNodeIds?: ID[];
  activePhases?: AgentFlowPhase[];
  completedPhases?: AgentFlowPhase[];
  nodeVisitCounts?: Record<ID, number>;
  maxIterations?: number;
  waitingForNodeId?: ID;
  returnToOrchestratorCount?: number;
  checkpoint?: AgentFlowCheckpoint;
  summary?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  finishedAt?: Timestamp;
}

export interface CreateAgentFlowRunDto {
  flowId: ID;
  goal: string;
  context?: string | Record<string, unknown>;
  parentSessionId: ID;
  parentToolCallId?: ID;
  startMode?: AgentFlowStartMode;
  vfsMode?: VFSMode;
  copyBack?: boolean;
  returnMode?: AgentFlowReturnMode;
  maxSteps?: number;
}

export interface ResumeAgentFlowRunDto {
  input?: string;
  context?: Record<string, unknown>;
  maxSteps?: number;
}

export interface AgentFlowRunSnapshot {
  run: AgentFlowRun;
  result?: SubAgentFlowResult;
  events: AgentFlowTraceItem[];
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
  /**
   * Backend-only: abort signal for the originating turn.
   * Tools and approval helpers can use this to stop follow-up work when the
   * user interrupts the parent turn.
   */
  readonly abortSignal?: AbortSignal;
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

export interface ToolConfirmationInvalidated {
  requestId: string;
  toolCallId?: string;
  sessionId: ID;
  reason: 'timeout' | 'cancelled' | 'confirmed' | 'not_found' | 'replay_stale';
  message?: string;
  agentRun?: AgentRunContext;
}

export type AgentBudgetApprovalDecision = 'block' | 'allow_one' | 'allow_ten' | 'allow_unlimited';

export interface AgentBudgetApprovalRequest {
  requestId: string;
  sessionId: ID;
  scope: Extract<SessionRuntimeKind, 'chat' | 'subagent' | 'agent-flow-branch'>;
  usedIterations: number;
  currentLimit: number;
  requestedBy?: string;
  suggestedNextLimit?: number;
  personaId?: ID;
  nodeId?: string;
  roleSlotId?: string;
  agentRun?: AgentRunContext;
}

export interface AgentBudgetApprovalInvalidated {
  requestId: string;
  sessionId: ID;
  reason: 'approved' | 'cancelled' | 'not_found' | 'aborted';
  decision?: AgentBudgetApprovalDecision;
  approvedLimit?: number;
  agentRun?: AgentRunContext;
}

export interface ConversationTitleSettings {
  autoRenameEnabled: boolean;
  renameEveryReplies: number;
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
  providerMaxConcurrentStreams: number;
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
export type MCPServerStore = 'toml' | 'sqlite';
export type MCPServerOriginSource = 'toml' | 'manual' | 'cursor' | 'windsurf' | 'codex' | 'copilot';
export type MCPServerEffectiveState = 'active' | 'shadowed' | 'conflict';

export interface MCPServer {
  id: ID;
  serverKey: string;
  name: string;
  store: MCPServerStore;
  originSource?: MCPServerOriginSource;
  effectiveState: MCPServerEffectiveState;
  conflictGroup?: string;
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
  name: string;               // runtime name: "mcp_<serverKey>_<toolName>"
  description: string;
  serverKey: ID;              // canonical origin-qualified runtime key, e.g. "toml::docs" or "sqlite::abc123"
  serverId?: ID;              // legacy alias kept for one release while clients migrate
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
  originSource?: Exclude<MCPServerOriginSource, 'toml'>;
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
  nativeResults?: RaAppNativeResult[];
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
  nativeResults?: RaAppNativeResult[];
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

export type ChatRunPhase =
  | 'queued'
  | 'started'
  | 'llm_streaming'
  | 'tool_pending'
  | 'tool_running'
  | 'completed'
  | 'interrupted'
  | 'failed';

export type ChatRunStatus =
  | 'active'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'interrupted_needs_retry';

export interface ChatRunSnapshot {
  id: ID;
  sessionId: ID;
  turnId: ID;
  phase: ChatRunPhase;
  status: ChatRunStatus;
  provider?: string;
  model?: string;
  retryCount: number;
  safeResume: boolean;
  errorCode?: string;
  errorMessage?: string;
  startedAt: Timestamp;
  updatedAt: Timestamp;
  lastHeartbeatAt: Timestamp;
  completedAt?: Timestamp;
}

// ─── Socket.IO Event Map ──────────────────────────────────────────────────────
export type RuntimeToolActivityStatus = 'pending_confirmation' | 'running' | 'success' | 'error' | 'cancelled';

export interface RuntimeToolActivity {
  callId: ID;
  requestId?: ID;
  sessionId: ID;
  toolName: string;
  args: Record<string, unknown>;
  status: RuntimeToolActivityStatus;
  startedAt?: Timestamp;
  finishedAt?: Timestamp;
  result?: ToolResult;
}

export type RuntimeChildExecutionKind = 'cli_agent' | 'subagent' | 'agent_flow';
export type RuntimeChildExecutionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped' | 'blocked' | 'cancelled' | 'waiting';

export interface RuntimeChildExecution {
  id: ID;
  kind: RuntimeChildExecutionKind;
  parentSessionId: ID;
  childSessionId: ID;
  parentToolCallId?: ID;
  flowRunId?: ID;
  cliRunId?: ID;
  label?: string;
  status: RuntimeChildExecutionStatus;
  lastOutput?: string;
  updatedAt: Timestamp;
}

export type RuntimeActivityEventType =
  | 'snapshot'
  | 'agent_started'
  | 'agent_done'
  | 'tool_started'
  | 'tool_finished'
  | 'child_updated';

export interface RuntimeActivityEvent {
  type: RuntimeActivityEventType;
  sessionId: ID;
  turnId?: ID;
  tool?: RuntimeToolActivity;
  child?: RuntimeChildExecution;
  at: Timestamp;
}

export interface RAAppLaunchIntent {
  targetSessionId: ID;
  appId: ID;
  appName: string;
  personaId: ID;
  prompt: string;
  source: 'home_tile' | 'raapp_manager' | 'quick_chat' | 'composer' | 'execution_graph';
}

export interface RuntimeActivitySnapshot {
  sessionId: ID;
  active: boolean;
  turnId?: ID;
  queueLength: number;
  run?: ChatRunSnapshot;
  pendingConfirmations: ToolConfirmationRequest[];
  pendingBudgetApprovals: AgentBudgetApprovalRequest[];
  toolActivities: RuntimeToolActivity[];
  childExecutions: RuntimeChildExecution[];
  raAppLaunchIntent?: RAAppLaunchIntent;
  updatedAt: Timestamp;
}

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
    code:
      | 'PROVIDER_NOT_CONFIGURED'
      | 'LLM_ERROR'
      | 'LLM_RATE_LIMIT'
      | 'LLM_TIMEOUT'
      | 'LLM_AUTH'
      | 'LLM_PROVIDER_DOWN'
      | 'LLM_QUOTA'
      | 'LLM_BAD_TOOL_ARGS'
      | 'TOOL_ERROR'
      | 'INTERRUPTED'
      | 'QUEUE_FULL'
      | 'MAX_ITERATIONS_REACHED';
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
  'tool:confirmation_invalidated': ToolConfirmationInvalidated;

  // Tool HITL — client → server
  'tool:confirm': { requestId: string; sessionId: ID; message?: string };
  'tool:cancel': { requestId: string; sessionId: ID; message?: string };
  'agent:budget_approve': { requestId: string; sessionId: ID; decision: AgentBudgetApprovalDecision };

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
  'agent:budget_required': AgentBudgetApprovalRequest;
  'agent:budget_invalidated': AgentBudgetApprovalInvalidated;

  // MCP — server → client
  'mcp:server:status': { serverKey: ID; serverId?: ID; serverName: string; status: string; toolCount: number; lastError?: string };
  'mcp:connected': { serverKey: ID; serverId?: ID; serverName: string; toolCount: number };
  'mcp:disconnected': { serverKey: ID; serverId?: ID; reason: string };
  'mcp:error': { serverKey: ID; serverId?: ID; error: string };

  // Sessions — server → client
  'session:created': ChatSession;
  'session:updated': ChatSession;
  'session:status': { sessionId: ID; active: boolean; turnId?: ID; queueLength: number; run?: ChatRunSnapshot };
  'session:runtime_snapshot': RuntimeActivitySnapshot;

  // Session re-registration — client → server (sent after reconnect)
  'session:identify': { sessionId: ID };

  // CLI Agent streaming — server → client
  'cli_agent:progress': { callId: ID; sessionId: ID; agentId: string; chunk: string };

  // Tool argument generation progress — server → client
  // Emitted ~once per second while the LLM streams tool call arguments (before tool:start).
  'tool:arg_progress': { toolName: string; totalChars: number; charsPerSec: number; sessionId: ID };

}

// ─── CLI Agent ────────────────────────────────────────────────────────────────
/** Result returned by the run_cli_agent tool after a CLI agent run completes. */
export interface CLIAgentResult {
  output: string;       // combined stdout+stderr from the CLI process (possibly compressed)
  exitCode: number;     // 0 = success, non-zero = failure
  durationMs: number;   // wall-clock time of the CLI run
  agentId: string;      // which adapter was used: 'copilot' | 'gemini' | 'claude' | …
  childSessionId?: ID;
}

export type CLIAgentSessionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped';

export interface CLIAgentSessionSnapshot {
  childSessionId: ID;
  parentSessionId: ID;
  agentId: string;
  workdir: string;
  status: CLIAgentSessionStatus;
  lastPrompt: string;
  updatedAt: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  activeCallId?: ID;
  lastOutput?: string;
  lastExitCode?: number;
  recoveryAttempts?: number;
}

/** Probe/availability info for a single CLI agent adapter. */
export interface CLIAgentAdapterInfo {
  id: string;
  displayName: string;
  installUrl: string;
  available: boolean;
  version: string | null;
  supportsModelSelection?: boolean;
}

/** Per-adapter configuration stored at ~/.kalio/cli-agents/{id}.json */
export interface CLIAgentConfig {
  /** Whether this agent is enabled. Default: true. */
  enabled: boolean;
  /** Override the executable path/name. Empty string = use adapter default. */
  cliPath: string;
  /** Max inactivity time in ms. Default: 900 000 (15 min). */
  timeoutMs: number;
  /** Optional hard wall-clock limit. Disabled by default for long-running CLI agents. */
  hardTimeoutEnabled?: boolean;
  /** Hard wall-clock limit in ms when hardTimeoutEnabled is true. */
  hardTimeoutMs?: number;
  /** Whether durable CLI sessions may auto-start a follow-up turn after idle timeout. */
  autoRecoveryEnabled?: boolean;
  /** Prompt used for auto-recovery follow-up turns. Defaults to "continue". */
  autoRecoveryPrompt?: string;
  /** Max output chars kept for LLM history. Default: 16 000. */
  maxOutputChars: number;
  /** Optional model override passed to adapters that support model selection. */
  model: string;
  /** Optional architecture-run preference shown in CLI-agent tool descriptions. */
  architecturePreference: string;
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

export interface MemoryScopeStats {
  id: string;
  label: string;
  count: number;
  size: number;
}

export interface MemoryScopeSummary {
  totalCount: number;
  totalSize: number;
  webSearch: MemoryScopeStats;
  personas: MemoryScopeStats[];
}

// ─── Embedding Credentials ───────────────────────────────────────────────────
// Independent credential table for embedding providers (separate from LLM
// credentials — embedding has `dimensions` and different provider set).
export type EmbeddingProviderType = 'openai' | 'cometapi' | 'openrouter' | 'ollama' | 'custom';
export type LocalEmbeddingBackend = 'auto' | 'webgpu' | 'cpu';

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

export interface UpdateLocalEmbeddingConfigDto {
  enabled: boolean;
  model: string;
  dimensions: number;
  backend: LocalEmbeddingBackend;
}

export interface EmbeddingStatus {
  provider: 'openai-compatible' | 'ollama' | 'local-transformers' | 'disabled' | 'mock';
  /** Where the active embedding config comes from */
  source: 'db' | 'env' | 'local' | 'disabled' | 'mock';
  model: string;
  dimensions: number;
  baseUrlMasked: string;
  configured: boolean;
  backend?: LocalEmbeddingBackend;
  activeBackend?: 'webgpu' | 'cpu';
  gpuAvailable?: boolean;
  cacheDir?: string;
  profileId?: string;
  modelParameters?: string;
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
  | 'architecture_event'
  | 'error'
  | 'raapp_native_call'
  | 'raapp_native_approved'
  | 'external_hitl'
  | 'escalation';

export type AuditDomain =
  | 'llm'
  | 'tool'
  | 'subagent'
  | 'architecture'
  | 'hitl'
  | 'hook'
  | 'vfs'
  | 'file'
  | 'raapp'
  | 'error'
  | 'generic';

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

export interface AuditRetentionPolicy {
  retentionDays: number;
  archiveRetentionDays: number;
  pruneEveryWrites: number;
  pruneIntervalHours: number;
  maxHotRows: number;
  maxArchivedRows: number;
}

export interface AuditRetentionStatus {
  hotRows: number;
  archivedRows: number;
  maxHotRows: number;
  maxArchivedRows: number;
  retentionDays: number;
  archiveRetentionDays: number;
  pruneEveryWrites: number;
  pruneIntervalHours: number;
  lastRetentionRunAt: Timestamp | null;
  nextRetentionRunAt: Timestamp | null;
  oldestHotEntryAt: Timestamp | null;
  newestHotEntryAt: Timestamp | null;
  oldestArchiveEntryAt: Timestamp | null;
  newestArchiveEntryAt: Timestamp | null;
  coldStorageEnabled: boolean;
  coldStorageMode: 'sqlite_table';
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

export type SecurityPolicyDecision = 'allow' | 'deny' | 'ask_user';
export type SecurityPolicyRisk = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityPolicyRequest {
  source: 'mcp-cli-agents' | 'kalio' | 'mcp' | 'raapp' | 'manual' | string;
  subject?: {
    userId?: string;
    agentId?: string;
    sessionId?: string;
    turnId?: string;
  };
  action: {
    kind: 'shell' | 'tool' | 'filesystem' | 'network' | 'credential' | 'agent_prompt' | string;
    name: string;
    commandOrTool?: string;
    args?: Record<string, unknown>;
    workdir?: string;
    paths?: string[];
  };
  risk: SecurityPolicyRisk;
  context?: {
    reason?: string;
    outputExcerpt?: string;
    repo?: string;
    permissionMode?: string;
  };
}

export interface SecurityPolicyResponse {
  decision: SecurityPolicyDecision;
  reason: string;
  risk?: SecurityPolicyRisk;
  ttlSeconds?: number;
  auditId?: string;
}

// Architecture Orchestration
export type ArchitectureNodeKind = 'parallel' | 'role' | 'router' | 'artifact';
export type ArchitectureNodeBehaviorMode =
  | 'fan_out_all'
  | 'choose_one'
  | 'rank_then_merge'
  | 'merge_inputs'
  | 'finalize';
export type ArchitectureNodeFanOutMode = 'parallel' | 'sequential';
export type ArchitectureNodeScoringPolicy = 'confidence' | 'risk' | 'cost' | 'custom';
export type ArchitectureRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ArchitectureExecutionMode = 'session_branches' | 'subagent_execution';
export type ArchitectureRouteSource = 'agent' | 'router' | 'parallel' | 'runtime_fallback';
export type ArchitectureEventAction =
  | 'run_created'
  | 'run_stopped'
  | 'participant_completed'
  | 'participant_incomplete'
  | 'router_selected'
  | 'router_returned_to_orchestrator'
  | 'router_incomplete'
  | 'router_synthesized'
  | 'finalizer_completed';
export type ArchitectureExecutionEventType =
  | 'run_created'
  | 'node_started'
  | 'agent_started'
  | 'participant_output'
  | 'router_decision'
  | 'router_output'
  | 'tool_call'
  | 'human_gate'
  | 'artifact_created'
  | 'memory_persisted'
  | 'final_artifact'
  | 'node_completed'
  | 'run_stopped';

export interface ArchitectureRoleSlot {
  id: string;
  label: string;
  description: string;
  slotType: 'participant' | 'router' | 'judge' | 'finalizer' | 'critic' | 'tool_executor';
  defaultPersonaId: ID;
  allowedPersonaTags: string[];
  required: boolean;
  canOverrideAtRunStart: boolean;
}

export interface ArchitectureSchemaNode {
  id: string;
  label: string;
  kind: ArchitectureNodeKind;
  roleSlotId?: string;
  maxToolAttempts?: number;
  behavior?: {
    mode: ArchitectureNodeBehaviorMode;
    fanOut?: ArchitectureNodeFanOutMode;
    convergeToNodeId?: string;
    maxBranches?: number;
    scoringPolicy?: ArchitectureNodeScoringPolicy;
    description?: string;
  };
  x?: number;
  y?: number;
}

export interface ArchitectureSchemaEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label?: string;
  returnToOrchestrator?: boolean;
}

export type ArchitectureContextCompression = 'none' | 'summary' | 'evidence_only';

export interface ArchitectureContextPolicyOverride {
  includeUserTask?: boolean;
  includeProjectMemory?: boolean;
  includeBrowserSession?: boolean;
  includePriorDecisions?: boolean;
  includeOtherAgentOutputs?: boolean;
  includeToolResults?: boolean;
  contextCompression?: ArchitectureContextCompression;
}

export interface ArchitectureContextPolicy {
  includeUserTask: boolean;
  includeProjectMemory: boolean;
  includeBrowserSession: boolean;
  includePriorDecisions: boolean;
  includeOtherAgentOutputs?: boolean;
  includeToolResults?: boolean;
  contextCompression?: ArchitectureContextCompression;
  perSlotOverrides?: Record<string, ArchitectureContextPolicyOverride>;
}

export interface ArchitectureSchema {
  id: ID;
  name: string;
  description: string;
  version: string;
  roleSlots: ArchitectureRoleSlot[];
  nodes: ArchitectureSchemaNode[];
  edges: ArchitectureSchemaEdge[];
  routerPolicy: {
    mode: 'rank_then_merge' | 'evidence_first' | 'risk_weighted';
    mustAddressCriticFindings: boolean;
    canReturnNeedsMoreResearch: boolean;
  };
  contextPolicy: ArchitectureContextPolicy;
  memoryPolicy: {
    persistFinalArtifact: boolean;
    persistRouterDecision: boolean;
  };
  outputArtifactSchema: string;
}

export interface CreateArchitectureRunDto {
  schemaId: ID;
  prompt: string;
  context?: Record<string, unknown>;
  slotOverrides?: Record<string, ID>;
  executionMode?: ArchitectureExecutionMode;
  schema?: ArchitectureSchema;
}

export interface CreateArchitectureSchemaVariantDto {
  name?: string;
  description?: string;
  roleSlotPersonaOverrides?: Record<string, ID>;
  nodeKindOverrides?: Record<string, ArchitectureNodeKind>;
  contextPolicy?: ArchitectureContextPolicy;
  nodes?: ArchitectureSchemaNode[];
  edges?: ArchitectureSchemaEdge[];
}

export interface ArchitectureRun {
  id: ID;
  schemaId: ID;
  prompt: string;
  executionMode: ArchitectureExecutionMode;
  context?: Record<string, unknown>;
  slotOverrides?: Record<string, ID>;
  rootSessionId?: ID;
  branchSessionIds?: Record<string, ID>;
  status: ArchitectureRunStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
}

export interface ArchitectureRouteDecision {
  source: ArchitectureRouteSource;
  fromNodeId: string;
  selectedNodeIds: string[];
  rejectedNodeIds?: string[];
  nextNodeId?: string;
  convergeToNodeId?: string;
  mode?: ArchitectureNodeBehaviorMode;
  response?: string;
}

export type ArchitectureRouterNextAction =
  | 'finalize'
  | 'ask_human'
  | 'run_more_research'
  | 'rerun_with_different_personas';

export interface ArchitectureRouterInsight {
  fromSlot: string;
  insight: string;
  whyAccepted?: string;
  whyRejected?: string;
}

export interface ArchitectureRouterRisk {
  risk: string;
  mitigation: string;
  sourceSlot: string;
}

export interface ArchitectureRouterOutput {
  selectedStrategy: string;
  mergedDecision: string;
  acceptedInputs: ArchitectureRouterInsight[];
  rejectedInputs: ArchitectureRouterInsight[];
  unresolvedConflicts: string[];
  risks: ArchitectureRouterRisk[];
  confidence: number;
  nextAction: ArchitectureRouterNextAction;
}

export interface ArchitectureRouteHop {
  eventId: ID;
  source: ArchitectureRouteSource;
  fromNodeId: string;
  toNodeId: string;
}

export interface ArchitectureExecutionEvent {
  id: ID;
  runId: ID;
  sequence: number;
  type: ArchitectureExecutionEventType;
  message: string;
  actionSummary?: string;
  action?: ArchitectureEventAction;
  detail?: string;
  nodeId?: string;
  roleSlotId?: string;
  route?: ArchitectureRouteDecision;
  routerOutput?: ArchitectureRouterOutput;
  data?: Record<string, unknown>;
  createdAt: Timestamp;
}

export interface ArchitectureGraphProjection {
  runId: ID;
  schemaId?: ID;
  schemaName?: string;
  status?: ArchitectureRunStatus;
  nodes: Array<{
    id: string;
    sessionId?: ID;
    label: string;
    kind: ArchitectureNodeKind;
    behavior?: ArchitectureSchemaNode['behavior'];
    status: 'pending' | 'running' | 'completed';
    actionSummary?: string;
    action?: ArchitectureEventAction;
    detail?: string;
    visitCount?: number;
    eventIds: ID[];
    toolEvidence?: Record<string, unknown>;
    incompleteReason?: string;
  }>;
  edges: ArchitectureSchemaEdge[];
  routeHops?: ArchitectureRouteHop[];
  childAgents?: ArchitectureChildAgentProjection[];
}

export interface ArchitectureChildAgentProjection {
  id: ID;
  parentNodeId?: string;
  parentRoleSlotId?: string;
  parentEventId?: ID;
  kind: ArchitectureChildAgentKind;
  backend?: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped' | 'unknown';
  toolName: string;
  workdir?: string;
  targetPaths?: string[];
  updatedAt?: Timestamp;
}

export interface ArchitectureChatProjection {
  runId: ID;
  messages: Array<{
    id: ID;
    eventId: ID;
    speaker: 'system' | 'participant' | 'router' | 'finalizer';
    content: string;
    actionSummary?: string;
    action?: ArchitectureEventAction;
    detail?: string;
    roleSlotId?: string;
    route?: ArchitectureRouteDecision;
    incompleteReason?: string;
    createdAt: Timestamp;
  }>;
}
