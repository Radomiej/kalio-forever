import { describe, expect, it } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ToolApplicationConfigModule } from './tool-application-config.module';
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
import { TOOL_CATALOG } from '../modules/tool/tool-catalog.port';
import { TOOL_DISPATCH_REGISTRY } from '../modules/tool/tool-dispatch-registry.port';
import { TOOL_PROVIDER_CLASSES } from '../modules/tool/tool.providers';
import { ToolRegistryService } from '../modules/tool/tool-registry.service';

describe('ToolApplicationConfigModule', () => {
  it('composes every tool dependency module exactly once', () => {
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, ToolApplicationConfigModule) as unknown[]) ?? [];

    expect(imports).toEqual([
      VFSModule,
      LLMModule,
      RAAppModule,
      MemoryModule,
      AllowedPathsModule,
      MCPModule,
      SearchModule,
      CLIAgentModule,
      ImageModule,
      SkillsModule,
      PersonaModule,
      CredentialsModule,
      RelayModule,
    ]);
  });

  it('builds a catalog from decorated tool providers and aliases the registry port', () => {
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ToolApplicationConfigModule) as Array<Record<string, unknown>>) ?? [];
    const catalogProvider = providers.find((provider) => provider.provide === TOOL_CATALOG);
    const registryProvider = providers.find((provider) => provider.provide === TOOL_DISPATCH_REGISTRY);

    expect(catalogProvider).toBeDefined();
    expect(catalogProvider?.inject).toEqual([Reflector]);
    expect(registryProvider).toEqual({ provide: TOOL_DISPATCH_REGISTRY, useExisting: ToolRegistryService });

    const catalog = (catalogProvider?.useFactory as (reflector: Reflector) => { getAllTools: () => Array<{ name: string }>; getToolsForSkills: (skills: string[]) => Array<{ name: string }>; })(new Reflector());

    expect(catalog.getAllTools()).toHaveLength(TOOL_PROVIDER_CLASSES.length);
    expect(catalog.getToolsForSkills(['vfs_read', 'persona_delete']).map((tool) => tool.name)).toEqual(['vfs_read', 'persona_delete']);
  });
});
