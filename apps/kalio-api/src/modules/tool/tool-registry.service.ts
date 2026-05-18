import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ToolMeta, ToolCallRequest } from '@kalio/types';
import { TOOL_METADATA, type ToolOptions } from '../../common/decorators/tool.decorator';
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

/** Minimal registry entry shape — structurally compatible with chat module's ToolRegistryEntry. */
export interface ToolEntry {
  meta: ToolMeta;
  execute(req: ToolCallRequest): Promise<unknown>;
}

type RegisteredToolEntry = ToolEntry & { defaultRequiresConfirmation: boolean };

type HasExecute = { execute(req: ToolCallRequest): Promise<unknown> };

/**
 * Reads @Tool() metadata off every tool class and exposes a typed registry
 * that ChatModule can consume via DI without direct cross-module imports.
 */
@Injectable()
export class ToolRegistryService {
  private readonly entries: RegisteredToolEntry[];

  constructor(
    private readonly reflector: Reflector,
    private readonly vfsWrite: VFSWriteTool,
    private readonly vfsRead: VFSReadTool,
    private readonly vfsList: VFSListTool,
    private readonly vfsGrepSearch: VFSGrepSearchTool,
    private readonly vfsFileSearch: VFSFileSearchTool,
    private readonly subagent: SubagentTool,
    private readonly spawnSubagent: SpawnSubagentTool,
    private readonly messageSubagent: MessageSubagentTool,
    private readonly fsRead: FsReadTool,
    private readonly fsList: FsListTool,
    private readonly fsWrite: FsWriteTool,
    private readonly kvWrite: KVWriteTool,
    private readonly kvRead: KVReadTool,
    private readonly kvList: KVListTool,
    private readonly kvDelete: KVDeleteTool,
    private readonly grepSearch: GrepSearchTool,
    private readonly fileSearch: FileSearchTool,
    private readonly terminalSpawn: TerminalSpawnTool,
    private readonly terminalList: TerminalListTool,
    private readonly terminalOutput: TerminalOutputTool,
    private readonly terminalKill: TerminalKillTool,
    private readonly raappCreate: RaAppCreateTool,
    private readonly raappCompile: RaAppCompileTool,
    private readonly runRaApp: RunRaAppTool,
    private readonly listRaApps: ListRaAppsTool,
    private readonly designPreview: DesignPreviewTool,
    private readonly raappGet: RaAppGetTool,
    private readonly raappEdit: RaAppEditTool,
    private readonly raappDelete: RaAppDeleteTool,
    private readonly raappCreateDraft: RaAppCreateDraftTool,
    private readonly raappExecuteDsl: RaAppExecuteDslTool,
    private readonly raappPublishDraft: RaAppPublishDraftTool,
    private readonly raappTest: RaAppTestTool,
    private readonly memoryIngest: MemoryIngestTool,
    private readonly memorySearch: MemorySearchTool,
    private readonly memoryIngestConversation: MemoryIngestConversationTool,
    private readonly webSearch: WebSearchTool,
    private readonly listTools: ListToolsTool,
    private readonly getToolDetails: GetToolDetailsTool,
    private readonly spawnCliAgent: SpawnCliAgentTool,
    private readonly messageCliAgent: MessageCliAgentTool,
    private readonly getCliAgentStatus: GetCliAgentStatusTool,
    private readonly stopCliAgent: StopCliAgentTool,
    private readonly runCliAgent: RunCliAgentTool,
    private readonly imageGenerate: ImageGenerateTool,
    private readonly imageEdit: ImageEditTool,
    private readonly imageView: ImageViewTool,
    private readonly skillList: SkillListTool,
    private readonly skillRead: SkillReadTool,
    private readonly skillCreate: SkillCreateTool,
    private readonly skillUpdate: SkillUpdateTool,
    private readonly skillDelete: SkillDeleteTool,
    private readonly personaList: PersonaListTool,
    private readonly personaCreate: PersonaCreateTool,
    private readonly personaUpdate: PersonaUpdateTool,
    private readonly personaDelete: PersonaDeleteTool,
    private readonly escalate: EscalateTool,
  ) {
    const all: object[] = [
      vfsWrite, vfsRead, vfsList, vfsGrepSearch, vfsFileSearch, subagent, spawnSubagent, messageSubagent,
      fsRead, fsList, fsWrite,
      kvWrite, kvRead, kvList, kvDelete,
      grepSearch, fileSearch,
      terminalSpawn, terminalList, terminalOutput, terminalKill,
      raappCreate, raappCompile, runRaApp, listRaApps,
      designPreview,
      raappGet, raappEdit, raappDelete,
      raappCreateDraft, raappExecuteDsl, raappPublishDraft,
      raappTest,
      memoryIngest, memorySearch, memoryIngestConversation,
      webSearch,
      listTools, getToolDetails,
      spawnCliAgent, messageCliAgent, getCliAgentStatus, stopCliAgent,
      runCliAgent,
      imageGenerate, imageEdit, imageView,
      skillList, skillRead, skillCreate, skillUpdate, skillDelete,
      personaList, personaCreate, personaUpdate, personaDelete,
      escalate,
    ];
    this.entries = all.map(t => this.toEntry(t));
  }

  getEntries(): ToolEntry[] {
    return this.entries;
  }

  getAllTools(): ToolMeta[] {
    return this.entries.map((entry) => entry.meta);
  }

  getToolsForSkills(skills: string[]): ToolMeta[] {
    const allowed = new Set(skills);
    return this.entries
      .map((entry) => entry.meta)
      .filter((meta) => allowed.has(meta.name));
  }

  /**
   * Update requiresConfirmation for a single tool in-memory.
   * Because ToolDispatchService holds references to the same meta objects,
   * this change is reflected immediately without a restart.
   */
  setOverride(toolName: string, requiresConfirmation: boolean): boolean {
    const entry = this.entries.find((e) => e.meta.name === toolName);
    if (!entry) return false;
    entry.meta.requiresConfirmation = entry.defaultRequiresConfirmation || requiresConfirmation;
    return true;
  }

  private toEntry(tool: object): RegisteredToolEntry {
    const opts = this.reflector.get<ToolOptions>(TOOL_METADATA, tool.constructor as NewableFunction);
    const defaultRequiresConfirmation = opts.requiresConfirmation ?? false;
    return {
      defaultRequiresConfirmation,
      meta: {
        name: opts.name,
        description: opts.description,
        parameters: opts.parameters,
        requiresConfirmation: defaultRequiresConfirmation,
      },
      execute: (req: ToolCallRequest) => (tool as HasExecute).execute(req),
    };
  }
}
