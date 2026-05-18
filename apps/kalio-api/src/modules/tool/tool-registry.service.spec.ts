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
import { RunCliAgentTool } from './tools/run-cli-agent.tool';
import { ImageGenerateTool } from './tools/image-generate.tool';
import { ImageEditTool } from './tools/image-edit.tool';
import { ImageViewTool } from './tools/image-view.tool';
import { SkillListTool, SkillReadTool, SkillCreateTool, SkillUpdateTool, SkillDeleteTool } from './tools/skill.tools';
import { PersonaListTool, PersonaCreateTool, PersonaUpdateTool, PersonaDeleteTool } from './tools/persona.tools';
import { EscalateTool } from './tools/escalate.tool';

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
      stub(WebSearchTool),
      stub(ListToolsTool),
      stub(GetToolDetailsTool),
      stub(SpawnCliAgentTool),
      stub(MessageCliAgentTool),
      stub(GetCliAgentStatusTool),
      stub(StopCliAgentTool),
      stub(RunCliAgentTool),
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
    // Web
    'web_search',
    // Meta
    'list_tools', 'get_tool_details',
    // CLI Agent
    'spawn_cli_agent', 'message_cli_agent', 'get_cli_agent_status', 'stop_cli_agent',
    'run_cli_agent',
    // Image
    'image_generate', 'image_edit', 'image_view',
    // Skills
    'skill_list', 'skill_read', 'skill_create', 'skill_update', 'skill_delete',
    // Personas
    'persona_list', 'persona_create', 'persona_update', 'persona_delete',
    // Escalate
    'escalate',
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
});
