import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { LLMToolCall, AgentLoopConfig, AgentLoopStatus, AgentTaskStatus } from '@kalio/types';

// ─── personas ─────────────────────────────────────────────────────────────────
export const personas = sqliteTable('personas', {
  id:           text('id').primaryKey(),
  name:         text('name').notNull(),
  systemPrompt: text('system_prompt').notNull().default(''),
  model:        text('model').notNull(),
  skills:       text('skills', { mode: 'json' }).$type<string[]>().notNull().default([]),
  createdAt:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:    integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── sessions ─────────────────────────────────────────────────────────────────
export const sessions = sqliteTable('sessions', {
  id:        text('id').primaryKey(),
  personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  title:     text('title').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── messages ─────────────────────────────────────────────────────────────────
export const messages = sqliteTable('messages', {
  id:         text('id').primaryKey(),
  sessionId:  text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role:       text('role', { enum: ['user', 'assistant', 'tool_result', 'system'] }).notNull(),
  content:    text('content').notNull(),
  toolCalls:  text('tool_calls', { mode: 'json' }).$type<LLMToolCall[] | null>(),
  toolCallId: text('tool_call_id'),  // for role='tool_result'
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

// ─── agent_loops ──────────────────────────────────────────────────────────────
export const agentLoops = sqliteTable('agent_loops', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  personaId:     text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  systemPrompt:  text('system_prompt').notNull().default(''),
  status:        text('status', {
    enum: ['idle', 'running', 'paused', 'stopped', 'error', 'completed'],
  }).notNull().default('idle').$type<AgentLoopStatus>(),
  config:        text('config', { mode: 'json' }).$type<AgentLoopConfig>().notNull(),
  currentTaskId: text('current_task_id'),
  chatSessionId: text('chat_session_id'),
  iterationCount: integer('iteration_count').notNull().default(0),
  createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:     integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── agent_tasks ──────────────────────────────────────────────────────────────
export const agentTasks = sqliteTable('agent_tasks', {
  id:            text('id').primaryKey(),
  loopId:        text('loop_id').notNull().references(() => agentLoops.id, { onDelete: 'cascade' }),
  title:         text('title').notNull(),
  description:   text('description').notNull().default(''),
  priority:      integer('priority').notNull().default(0),
  status:        text('status', {
    enum: ['pending', 'running', 'done', 'failed', 'skipped'],
  }).notNull().default('pending').$type<AgentTaskStatus>(),
  resultSummary: text('result_summary'),
  orderIndex:    integer('order_index').notNull().default(0),
  createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:     integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── agent_iterations ─────────────────────────────────────────────────────────
export const agentIterations = sqliteTable('agent_iterations', {
  id:              text('id').primaryKey(),
  loopId:          text('loop_id').notNull().references(() => agentLoops.id, { onDelete: 'cascade' }),
  taskId:          text('task_id'),
  iterationNumber: integer('iteration_number').notNull(),
  action:          text('action', {
    enum: ['execute_task', 'pause', 'resume', 'error', 'watchdog'],
  }).notNull(),
  promptUsed:      text('prompt_used').notNull().default(''),
  resultSummary:   text('result_summary').notNull().default(''),
  durationMs:      integer('duration_ms').notNull().default(0),
  createdAt:       integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── app_settings ──────────────────────────────────────────────────────────────
// Global key-value store for app-wide settings (e.g. active LLM credential)
export const appSettings = sqliteTable('app_settings', {
  key:       text('key').primaryKey(),
  value:     text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── Type inference helpers ───────────────────────────────────────────────────
export type PersonaRow         = typeof personas.$inferSelect;
export type SessionRow         = typeof sessions.$inferSelect;
export type MessageRow         = typeof messages.$inferSelect;
export type PersonaKVRow       = typeof personaKV.$inferSelect;
export type CredentialRow      = typeof credentials.$inferSelect;
export type MCPServerRow       = typeof mcpServers.$inferSelect;
export type SkillRow           = typeof skills.$inferSelect;
export type AgentLoopRow       = typeof agentLoops.$inferSelect;
export type AgentTaskRow       = typeof agentTasks.$inferSelect;
export type AgentIterationRow  = typeof agentIterations.$inferSelect;
export type AppSettingRow      = typeof appSettings.$inferSelect;

export type InsertPersona      = typeof personas.$inferInsert;
export type InsertSession      = typeof sessions.$inferInsert;
export type InsertMessage      = typeof messages.$inferInsert;
export type InsertPersonaKV    = typeof personaKV.$inferInsert;
export type InsertCredential   = typeof credentials.$inferInsert;
export type InsertMCPServer    = typeof mcpServers.$inferInsert;
export type InsertSkill        = typeof skills.$inferInsert;
export type InsertAgentLoop    = typeof agentLoops.$inferInsert;
export type InsertAgentTask    = typeof agentTasks.$inferInsert;
export type InsertAgentIteration = typeof agentIterations.$inferInsert;
