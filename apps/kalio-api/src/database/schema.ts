import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { LLMToolCall } from '@kalio/types';

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
  url:       text('url').notNull(),
  status:    text('status', {
    enum: ['connecting', 'connected', 'disconnected', 'error'],
  }).notNull().default('disconnected'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── app_settings ──────────────────────────────────────────────────────────────
// Global key-value store for app-wide settings (e.g. active LLM credential)
export const appSettings = sqliteTable('app_settings', {
  key:       text('key').primaryKey(),
  value:     text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── Type inference helpers ───────────────────────────────────────────────────
export type PersonaRow      = typeof personas.$inferSelect;
export type SessionRow      = typeof sessions.$inferSelect;
export type MessageRow      = typeof messages.$inferSelect;
export type PersonaKVRow    = typeof personaKV.$inferSelect;
export type CredentialRow   = typeof credentials.$inferSelect;
export type MCPServerRow    = typeof mcpServers.$inferSelect;
export type AppSettingRow   = typeof appSettings.$inferSelect;

export type InsertPersona    = typeof personas.$inferInsert;
export type InsertSession    = typeof sessions.$inferInsert;
export type InsertMessage    = typeof messages.$inferInsert;
export type InsertPersonaKV  = typeof personaKV.$inferInsert;
export type InsertCredential = typeof credentials.$inferInsert;
export type InsertMCPServer  = typeof mcpServers.$inferInsert;
