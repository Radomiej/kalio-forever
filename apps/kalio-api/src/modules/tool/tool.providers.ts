import type { Provider } from '@nestjs/common';
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
import { RunCliAgentTool } from './tools/run-cli-agent.tool';
import { ImageGenerateTool } from './tools/image-generate.tool';
import { ImageEditTool } from './tools/image-edit.tool';
import { ImageViewTool } from './tools/image-view.tool';
import { SkillListTool, SkillReadTool, SkillCreateTool, SkillUpdateTool, SkillDeleteTool } from './tools/skill.tools';
import { PersonaListTool, PersonaCreateTool, PersonaUpdateTool, PersonaDeleteTool } from './tools/persona.tools';
import { KVStoreService } from './kv-store.service';
import { TerminalService } from './terminal.service';
import { ToolRegistryService } from './tool-registry.service';

export const TOOL_PROVIDER_CLASSES = [
  VFSWriteTool, VFSReadTool, VFSListTool, VFSGrepSearchTool, VFSFileSearchTool,
  SubagentTool, SpawnSubagentTool, MessageSubagentTool,
  FsReadTool, FsListTool, FsWriteTool,
  KVWriteTool, KVReadTool, KVListTool, KVDeleteTool,
  GrepSearchTool, FileSearchTool,
  TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool,
  RaAppCreateTool, RaAppCompileTool, RunRaAppTool, ListRaAppsTool,
  DesignPreviewTool,
  RaAppGetTool, RaAppEditTool, RaAppDeleteTool,
  RaAppCreateDraftTool, RaAppExecuteDslTool, RaAppPublishDraftTool,
  RaAppTestTool,
  MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool,
  WebSearchTool,
  ListToolsTool, GetToolDetailsTool,
  RunCliAgentTool,
  ImageGenerateTool, ImageEditTool, ImageViewTool,
  SkillListTool, SkillReadTool, SkillCreateTool, SkillUpdateTool, SkillDeleteTool,
  PersonaListTool, PersonaCreateTool, PersonaUpdateTool, PersonaDeleteTool,
] as const;

export const TOOL_CONFIGURATION_PROVIDERS: Provider[] = [
  KVStoreService,
  TerminalService,
  ...TOOL_PROVIDER_CLASSES,
  ToolRegistryService,
];