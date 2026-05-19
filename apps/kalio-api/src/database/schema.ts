import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { LLMToolCall, ChatAttachment, MCPPolicy } from '@kalio/types';
// ─── personas ──────────────────────────────────────────────────────────────────
export const personas = sqliteTable('personas', {
  id:           text('id').primaryKey(),
  name:         text('name').notNull(),
  systemPrompt: text('system_prompt').notNull().default(''),
  model:        text('model').notNull(),
  allowedTools: text('allowed_tools', { mode: 'json' }).$type<string[]>().notNull().default([]),
  skillIds:     text('skill_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
  mcpPolicy:    text('mcp_policy').$type<MCPPolicy>().notNull().default('allow_all'),
  createdAt:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:    integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── sessions ─────────────────────────────────────────────────────────────────
export const sessions = sqliteTable('sessions', {
  id:          text('id').primaryKey(),
  personaId:   text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  title:       text('title').notNull().default(''),
  kind:        text('kind', { enum: ['chat', 'subagent', 'cli-agent'] }).notNull().default('chat'),
  parentSessionId: text('parent_session_id'),
  parentTurnId: text('parent_turn_id'),
  parentToolCallId: text('parent_tool_call_id'),
  createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:   integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── messages ─────────────────────────────────────────────────────────────────
export const messages = sqliteTable('messages', {
  id:         text('id').primaryKey(),
  sessionId:  text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role:       text('role', { enum: ['user', 'assistant', 'tool_result', 'system'] }).notNull(),
  content:    text('content').notNull(),
  thinking:   text('thinking'),       // reasoning content from models like MiMo / DeepSeek
  toolCalls:  text('tool_calls', { mode: 'json' }).$type<LLMToolCall[] | null>(),
  toolCallId: text('tool_call_id'),  // for role='tool_result'
  attachments: text('attachments', { mode: 'json' }).$type<ChatAttachment[] | null>(),
  createdAt:  integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── persona_kv ───────────────────────────────────────────────────────────────
export const personaKV = sqliteTable('persona_kv', {
  id:        text('id').primaryKey(),
  personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  key:       text('key').notNull(),
  value:     text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── app_settings ────────────────────────────────────────────────────────────
export const appSettings = sqliteTable('app_settings', {
  key:       text('key').primaryKey(),
  value:     text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── embedding_credentials ────────────────────────────────────────────────────
export const embeddingCredentials = sqliteTable('embedding_credentials', {
  id:         text('id').primaryKey(),
  name:       text('name').notNull(),
  provider:   text('provider').notNull(),   // EmbeddingProviderType
  apiKey:     text('api_key').notNull(),    // encrypt post-MVP: libsodium secretbox
  baseUrl:    text('base_url').notNull(),
  model:      text('model').notNull(),
  dimensions: integer('dimensions').notNull().default(1536),
  createdAt:  integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── credentials ──────────────────────────────────────────────────────────────
export const credentials = sqliteTable('credentials', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  provider:  text('provider').notNull(),
  apiKey:    text('api_key').notNull(),   // encrypt post-MVP: libsodium secretbox
  baseUrl:   text('base_url'),
  model:     text('model'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── mcp_servers ──────────────────────────────────────────────────────────────
export const mcpServers = sqliteTable('mcp_servers', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  transport: text('transport', { enum: ['stdio', 'http'] }).notNull().default('http'),
  url:       text('url'),               // for http transport
  command:   text('command'),           // for stdio transport
  args:      text('args', { mode: 'json' }).$type<string[]>(),
  envVars:   text('env_vars', { mode: 'json' }).$type<Record<string, string>>(),
  headers:   text('headers', { mode: 'json' }).$type<Record<string, string>>(),
  enabled:   integer('enabled', { mode: 'boolean' }).notNull().default(true),
  status:    text('status', {
    enum: ['connecting', 'connected', 'disconnected', 'error', 'stopped'],
  }).notNull().default('disconnected'),
  toolCount: integer('tool_count').notNull().default(0),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── skills ───────────────────────────────────────────────────────────────────
export const skills = sqliteTable('skills', {
  id:          text('id').primaryKey(),
  name:        text('name').notNull(),
  description: text('description').notNull().default(''),
  prompt:      text('prompt').notNull(),       // injected into system prompt
  source:      text('source', { enum: ['user', 'agent'] }).notNull().default('user'),
  createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:   integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── tool_overrides ────────────────────────────────────────────────────────────
// Persists user overrides for per-tool requiresConfirmation flag.
export const toolOverrides = sqliteTable('tool_overrides', {
  toolName:             text('tool_name').primaryKey(),
  requiresConfirmation: integer('requires_confirmation', { mode: 'boolean' }).notNull(),
  updatedAt:            integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── allowed_paths ─────────────────────────────────────────────────────────────
// Configurable list of filesystem roots the agent can access via fs_* tools
export const allowedPaths = sqliteTable('allowed_paths', {
  id:        text('id').primaryKey(),
  path:      text('path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── raapp_pending_approvals ──────────────────────────────────────────────────
// Persists call_native approval requests that require explicit user confirmation.
export const raappPendingApprovals = sqliteTable('raapp_pending_approvals', {
  id:          text('id').primaryKey(),
  sessionId:   text('session_id').notNull(),
  toolCallId:  text('tool_call_id').notNull(),
  system:      text('system').notNull(),
  args:        text('args', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  outputPath:  text('output_path'),
  displayLabel: text('display_label').notNull(),
  status:      text('status', {
    enum: ['pending', 'approved', 'cancelled', 'executed', 'error'],
  }).notNull().default('pending'),
  result:      text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── audit_log ────────────────────────────────────────────────────────────────
export const auditLog = sqliteTable('audit_log', {
  id:         text('id').primaryKey(),
  sessionId:  text('session_id'),
  type:       text('type', {
    enum: ['llm_request', 'llm_response', 'tool_call', 'tool_result', 'error', 'raapp_native_call', 'raapp_native_approved', 'escalation'],
  }).notNull().$type<'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'error' | 'raapp_native_call' | 'raapp_native_approved' | 'escalation'>(),
  label:      text('label').notNull(),
  data:       text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
  durationMs: integer('duration_ms'),
  chunkCount: integer('chunk_count'),
  createdAt:  integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── Type inference helpers ───────────────────────────────────────────────────
export type PersonaRow         = typeof personas.$inferSelect;
export type SessionRow         = typeof sessions.$inferSelect;
export type MessageRow         = typeof messages.$inferSelect;
export type PersonaKVRow       = typeof personaKV.$inferSelect;
export type CredentialRow      = typeof credentials.$inferSelect;
export type MCPServerRow       = typeof mcpServers.$inferSelect;
export type SkillRow           = typeof skills.$inferSelect;
export type ToolOverrideRow    = typeof toolOverrides.$inferSelect;
export type AuditLogRow        = typeof auditLog.$inferSelect;
export type AppSettingRow      = typeof appSettings.$inferSelect;
export type AllowedPathRow     = typeof allowedPaths.$inferSelect;
export type RaappPendingApprovalRow = typeof raappPendingApprovals.$inferSelect;

export type InsertPersona      = typeof personas.$inferInsert;
export type InsertSession      = typeof sessions.$inferInsert;
export type InsertMessage      = typeof messages.$inferInsert;
export type InsertPersonaKV    = typeof personaKV.$inferInsert;
export type InsertCredential   = typeof credentials.$inferInsert;
export type InsertMCPServer    = typeof mcpServers.$inferInsert;
export type InsertSkill        = typeof skills.$inferInsert;
export type InsertAllowedPath   = typeof allowedPaths.$inferInsert;
export type EmbeddingCredentialRow    = typeof embeddingCredentials.$inferSelect;
export type InsertEmbeddingCredential = typeof embeddingCredentials.$inferInsert;
