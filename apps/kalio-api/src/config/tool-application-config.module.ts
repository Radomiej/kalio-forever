import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ToolMeta } from '@kalio/types';
import { TOOL_METADATA, type ToolOptions } from '../common/decorators/tool.decorator';
import { VFSModule } from '../modules/vfs/vfs.module';
import { LLMModule } from '../modules/llm/llm.module';
import { RAAppModule } from '../modules/raapp/raapp.module';
import { MemoryModule } from '../modules/memory/memory.module';
import { AllowedPathsModule } from '../modules/allowed-paths/allowed-paths.module';
import { MCPModule } from '../modules/mcp/mcp.module';
import { SearchModule } from '../modules/search/search.module';
import { CLIAgentModule } from '../modules/cli-agent/cli-agent.module';
import { ImageModule } from '../modules/image/image.module';
import { SkillsModule } from '../modules/skills/skills.module';
import { PersonaModule } from '../modules/persona/persona.module';
import { CredentialsModule } from '../modules/credentials/credentials.module';
import { RelayModule } from '../modules/relay/relay.module';
import { TOOL_CATALOG, type ToolCatalogPort } from '../modules/tool/tool-catalog.port';
import { TOOL_DISPATCH_REGISTRY } from '../modules/tool/tool-dispatch-registry.port';
import { TOOL_CONFIGURATION_PROVIDERS, TOOL_PROVIDER_CLASSES } from '../modules/tool/tool.providers';
import { ToolRegistryService } from '../modules/tool/tool-registry.service';

type ToolClass = (abstract new (...args: never[]) => object) & { name: string };

function toMeta(reflector: Reflector, ToolClass: ToolClass): ToolMeta {
  const options = reflector.get<ToolOptions | undefined>(TOOL_METADATA, ToolClass as never);
  if (!options) {
    throw new Error(`Missing @Tool metadata on ${ToolClass.name}`);
  }

  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    requiresConfirmation: options.requiresConfirmation ?? false,
  };
}

function buildToolCatalog(reflector: Reflector): ToolCatalogPort {
  const metas = TOOL_PROVIDER_CLASSES.map((ToolClass) => toMeta(reflector, ToolClass));

  return {
    getAllTools: () => metas,
    getToolsForSkills: (skills: string[]) => {
      const allowed = new Set(skills);
      return metas.filter((meta) => allowed.has(meta.name));
    },
  };
}

@Module({
  imports: [VFSModule, LLMModule, RAAppModule, MemoryModule, AllowedPathsModule, MCPModule, SearchModule, CLIAgentModule, ImageModule, SkillsModule, PersonaModule, CredentialsModule, RelayModule],
  providers: [
    ...TOOL_CONFIGURATION_PROVIDERS,
    {
      provide: TOOL_CATALOG,
      useFactory: (reflector: Reflector) => buildToolCatalog(reflector),
      inject: [Reflector],
    },
    {
      provide: TOOL_DISPATCH_REGISTRY,
      useExisting: ToolRegistryService,
    },
  ],
  exports: [MCPModule, ToolRegistryService, TOOL_CATALOG, TOOL_DISPATCH_REGISTRY],
})
export class ToolApplicationConfigModule {}