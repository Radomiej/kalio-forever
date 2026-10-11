/**
 * tool-registry.service.spec.ts
 *
 * Verifies that every tool wired in tool.module.ts is actually present in
 * ToolRegistryService. This acts as a canary: if someone adds a tool to the
 * module but forgets to inject it into the registry, this test fails loudly
 * instead of the agent silently losing the tool.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ToolRegistryService } from './tool-registry.service';

// ── Minimal tool stub factory ─────────────────────────────────────────────────
//
// We don't need real service instances — we only need objects whose classes
// have the @Tool() decorator applied. The real decorators are on the actual
// classes, so we import the real classes and pass plain mocked instances.

import { VFSWriteTool } from './tools/vfs-write.tool';
import { VFSReadTool } from './tools/vfs-read.tool';
import { VFSListTool } from './tools/vfs-list.tool';
import { VFSGrepSearchTool, VFSFileSearchTool } from './tools/vfs-search.tools';
import { MessageSubagentTool, SpawnSubagentTool, SubagentTool } from './tools/subagent.tool';
import { FsReadTool } from './tools/fs-read.tool';
import { FsListTool } from './tools/fs-list.tool';
import { FsWriteTool } from './tools/fs-write.tool';
import { KVWriteTool, KVReadTool, KVListTool, KVDeleteTool } from './tools/kv.tools';
import { GrepSearchTool, FileSearchTool } from './tools/file-search.tools';
import { TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool } from './tools/terminal.tools';
import { RaAppCreateTool, RaAppCompileTool, RunRaAppTool, ListRaAppsTool } from './tools/raapp.tools';
import { DesignPreviewTool } from './tools/design-preview.tool';
import { RaAppGetTool, RaAppEditTool, RaAppDeleteTool } from './tools/raapp-crud.tools';
import { RaAppCreateDraftTool, RaAppExecuteDslTool, RaAppPublishDraftTool } from './tools/raapp-draft.tools';
import { RaAppTestTool } from './tools/raapp-test.tools';
import { MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool } from './tools/memory.tools';
import { WebSearchTool } from './tools/web-search.tool';
import { ListToolsTool } from './tools/list-tools.tool';
import { GetToolDetailsTool } from './tools/get-tool-details.tool';
import { GetCliAgentStatusTool, MessageCliAgentTool, SpawnCliAgentTool, StopCliAgentTool } from './tools/cli-agent-session.tools';
import { WaitForTool } from './tools/wait-for.tool';
import { RunCliAgentTool } from './tools/run-cli-agent.tool';
import { RunSubAgentFlowTool } from './tools/run-sub-agentflow.tool';
import { ImageGenerateTool } from './tools/image-generate.tool';
import { ImageEditTool } from './tools/image-edit.tool';
import { ImageViewTool } from './tools/image-view.tool';
import { SkillListTool, SkillReadTool, SkillCreateTool, SkillUpdateTool, SkillDeleteTool } from './tools/skill.tools';
import { PersonaListTool, PersonaCreateTool, PersonaUpdateTool, PersonaDeleteTool } from './tools/persona.tools';
import { EscalateTool } from './tools/escalate.tool';
import { IdeDiagnosticsTool, IdeQueryTool, IdeStatusTool } from '../code-intelligence/code-intelligence.tools';
import { RefreshProjectContextTool, SearchProjectContextTool } from './tools/project-context.tools';

/** Create a stub whose constructor is the real class (so @Tool metadata is present) */
function stub<T extends abstract new (...a: never[]) => object>(Cls: T): InstanceType<T> {
  return Object.create(Cls.prototype) as InstanceType<T>;
}

describe('ToolRegistryService — all tools registered', () => {
  let registry: ToolRegistryService;

  beforeEach(() => {
    const reflector = new Reflector();
    registry = new ToolRegistryService(
      reflector,
      stub(VFSWriteTool),
      stub(VFSReadTool),
      stub(VFSListTool),
      stub(VFSGrepSearchTool),
      stub(VFSFileSearchTool),
      stub(SubagentTool),
      stub(SpawnSubagentTool),
      stub(MessageSubagentTool),
      stub(FsReadTool),
      stub(FsListTool),
      stub(FsWriteTool),
      stub(KVWriteTool),
      stub(KVReadTool),
      stub(KVListTool),
      stub(KVDeleteTool),
      stub(GrepSearchTool),
      stub(FileSearchTool),
      stub(TerminalSpawnTool),
      stub(TerminalListTool),
      stub(TerminalOutputTool),
      stub(TerminalKillTool),
      stub(RaAppCreateTool),
      stub(RaAppCompileTool),
      stub(RunRaAppTool),
      stub(ListRaAppsTool),
      stub(DesignPreviewTool),
      stub(RaAppGetTool),
      stub(RaAppEditTool),
      stub(RaAppDeleteTool),
      stub(RaAppCreateDraftTool),
      stub(RaAppExecuteDslTool),
      stub(RaAppPublishDraftTool),
      stub(RaAppTestTool),
      stub(MemoryIngestTool),
      stub(MemorySearchTool),
      stub(MemoryIngestConversationTool),
      stub(RefreshProjectContextTool),
      stub(SearchProjectContextTool),
      stub(WebSearchTool),
      stub(ListToolsTool),
      stub(GetToolDetailsTool),
      stub(SpawnCliAgentTool),
      stub(MessageCliAgentTool),
      stub(GetCliAgentStatusTool),
      stub(StopCliAgentTool),
      stub(WaitForTool),
      stub(RunCliAgentTool),
      stub(RunSubAgentFlowTool),
      stub(ImageGenerateTool),
      stub(ImageEditTool),
      stub(ImageViewTool),
      stub(SkillListTool),
      stub(SkillReadTool),
      stub(SkillCreateTool),
      stub(SkillUpdateTool),
      stub(SkillDeleteTool),
      stub(PersonaListTool),
      stub(PersonaCreateTool),
      stub(PersonaUpdateTool),
      stub(PersonaDeleteTool),
      stub(EscalateTool),
      stub(IdeQueryTool),
      stub(IdeDiagnosticsTool),
      stub(IdeStatusTool),
    );
  });

  const EXPECTED_TOOLS = [
    // VFS
    'vfs_write', 'vfs_read', 'vfs_list', 'vfs_grep_search', 'vfs_file_search',
    // Subagent
    'run_subagent', 'spawn_subagent', 'message_subagent',
    // FS
    'fs_read', 'fs_list', 'fs_write',
    // KV
    'kv_write', 'kv_read', 'kv_list', 'kv_delete',
    // File search
    'grep_search', 'file_search',
    // Terminal
    'terminal_spawn', 'terminal_list', 'terminal_output', 'terminal_kill',
    // RA-App
    'raapp_create', 'raapp_compile', 'run_raapp', 'list_raapps',
    'design_preview',
    'raapp_get', 'raapp_edit', 'raapp_delete',
    'raapp_create_draft', 'raapp_execute_dsl', 'raapp_publish_draft',
    'raapp_test',
    // Memory
    'memory_ingest', 'memory_search', 'memory_ingest_conversation',
    'refresh_project_context', 'search_project_context',
    // Web
    'web_search',
    // Meta
    'list_tools', 'get_tool_details',
    // CLI Agent
    'spawn_cli_agent', 'message_cli_agent', 'get_cli_agent_status', 'stop_cli_agent',
    'wait_for',
    'run_cli_agent',
    // AgentFlow
    'run_sub_agentflow',
    // Image
    'image_generate', 'image_edit', 'image_view',
    // Skills
    'skill_list', 'skill_read', 'skill_create', 'skill_update', 'skill_delete',
    // Personas
    'persona_list', 'persona_create', 'persona_update', 'persona_delete',
    // Escalate
    'escalate',
    // Code intelligence
    'ide_query', 'ide_diagnostics', 'ide_status',
  ];

  it('exposes every expected tool via getAllTools()', () => {
    const names = registry.getAllTools().map((m) => m.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(names, `Missing tool: ${expected}`).toContain(expected);
    }
  });

  it('total tool count matches expectation (catches forgotten removals too)', () => {
    expect(registry.getAllTools().length).toBe(EXPECTED_TOOLS.length);
  });

  it('each entry has a non-empty description', () => {
    for (const meta of registry.getAllTools()) {
      expect(meta.description.length, `${meta.name} has empty description`).toBeGreaterThan(5);
    }
  });

  it('each entry has a valid parameters schema', () => {
    for (const meta of registry.getAllTools()) {
      expect(meta.parameters.type, `${meta.name} missing type`).toBe('object');
      expect(meta.parameters.properties, `${meta.name} missing properties`).toBeDefined();
    }
  });

  it('registers project context tools as confirmation-gated tools', () => {
    const tools = registry.getAllTools();
    expect(tools.find(tool => tool.name === 'refresh_project_context')?.requiresConfirmation).toBe(true);
    expect(tools.find(tool => tool.name === 'search_project_context')?.requiresConfirmation).toBe(true);
  });

  it('getToolsForSkills filters to the requested subset', () => {
    const subset = registry.getToolsForSkills(['fs_read', 'vfs_write', 'terminal_spawn']);
    expect(subset.map((m) => m.name).sort()).toEqual(['fs_read', 'terminal_spawn', 'vfs_write']);
  });

  it('setOverride does not downgrade tools that require confirmation by default', () => {
    const before = registry.getAllTools().find((m) => m.name === 'terminal_spawn')!;
    expect(before.requiresConfirmation).toBe(true);

    const changed = registry.setOverride('terminal_spawn', false);
    expect(changed).toBe(true);

    const after = registry.getAllTools().find((m) => m.name === 'terminal_spawn')!;
    expect(after.requiresConfirmation).toBe(true);
  });

  it('setOverride still allows non-destructive tools to toggle confirmation on and off', () => {
    const before = registry.getAllTools().find((m) => m.name === 'terminal_list')!;
    expect(before.requiresConfirmation).toBe(false);

    expect(registry.setOverride('terminal_list', true)).toBe(true);
    expect(registry.getAllTools().find((m) => m.name === 'terminal_list')?.requiresConfirmation).toBe(true);

    expect(registry.setOverride('terminal_list', false)).toBe(true);
    expect(registry.getAllTools().find((m) => m.name === 'terminal_list')?.requiresConfirmation).toBe(false);
  });

  it('setOverride returns false for unknown tool names', () => {
    expect(registry.setOverride('does_not_exist', false)).toBe(false);
  });

  const PROOF_IDENTITIES = [
    ['fs_list', 'kalio.catalog.fs-list', 'kalio.executor.fs-list'],
    ['fs_read', 'kalio.catalog.fs-read', 'kalio.executor.fs-read'],
    ['fs_write', 'kalio.catalog.fs-write', 'kalio.executor.fs-write'],
    ['terminal_spawn', 'kalio.catalog.terminal-spawn', 'kalio.executor.terminal-spawn'],
    ['terminal_list', 'kalio.catalog.terminal-list', 'kalio.executor.terminal-list'],
    ['terminal_output', 'kalio.catalog.terminal-output', 'kalio.executor.terminal-output'],
    ['run_sub_agentflow', 'kalio.catalog.run-sub-agentflow', 'kalio.executor.run-sub-agentflow'],
  ] as const;

  it.each(PROOF_IDENTITIES)('exposes explicit host identity for %s', (name, catalogEntryId, executorImplementationId) => {
    const entry = registry.getEntries().find(item => item.meta.name === name);
    expect(entry).toMatchObject({ catalogEntryId, executorImplementationId, executorImplementationVersion: 1 });
  });

  it('does not manufacture identities for any other registered tool', () => {
    const allowed = new Set<string>(PROOF_IDENTITIES.map(([name]) => name));
    for (const entry of registry.getEntries().filter(item => !allowed.has(item.meta.name))) {
      for (const field of ['catalogEntryId', 'executorImplementationId', 'executorImplementationVersion']) {
        expect(Object.hasOwn(entry, field), `${entry.meta.name}/${field}`).toBe(false);
      }
    }
  });

  it('retains entries, executors, metadata and identity across confirmation overrides', () => {
    const entries = registry.getEntries();
    const entry = entries.find(item => item.meta.name === 'terminal_list')!;
    const executor = entry.execute; const meta = entry.meta;
    expect(registry.setOverride('terminal_list', true)).toBe(true);
    expect(registry.getEntries()).toBe(entries);
    expect(registry.getEntries().find(item => item.meta.name === 'terminal_list')).toBe(entry);
    expect(entry.execute).toBe(executor); expect(entry.meta).toBe(meta);
    expect(meta.requiresConfirmation).toBe(true);
    expect(registry.setOverride('terminal_list', false)).toBe(true);
    expect(meta.requiresConfirmation).toBe(false);
    expect(entry).toMatchObject({ catalogEntryId: 'kalio.catalog.terminal-list', executorImplementationId: 'kalio.executor.terminal-list', executorImplementationVersion: 1 });
  });

  it('makes identities immutable without freezing mutable confirmation metadata', () => {
    const entry = registry.getEntries().find(item => item.meta.name === 'fs_read')!;
    for (const key of ['catalogEntryId', 'executorImplementationId', 'executorImplementationVersion']) {
      expect(Object.getOwnPropertyDescriptor(entry, key)).toMatchObject({ writable: false, configurable: false, enumerable: true });
      expect(Reflect.set(entry, key, 'foreign')).toBe(false);
      expect(Reflect.deleteProperty(entry, key)).toBe(false);
    }
    expect(Object.isFrozen(entry.meta)).toBe(false);
  });

  it('does not expose authority identity fields in model tool metadata', () => {
    for (const meta of [...registry.getAllTools(), ...registry.getToolsForSkills(['fs_read', 'terminal_spawn'])]) {
      expect(meta).not.toHaveProperty('catalogEntryId');
      expect(meta).not.toHaveProperty('executorImplementationId');
      expect(meta).not.toHaveProperty('executorImplementationVersion');
    }
  });
});
