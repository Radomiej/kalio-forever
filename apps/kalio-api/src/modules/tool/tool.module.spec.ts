import { describe, it, expect } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ToolModule } from './tool.module';
import { VFSModule } from '../vfs/vfs.module';
import { LLMModule } from '../llm/llm.module';
import { RAAppModule } from '../raapp/raapp.module';
import { MemoryModule } from '../memory/memory.module';
import { AllowedPathsModule } from '../allowed-paths/allowed-paths.module';
import { MCPModule } from '../mcp/mcp.module';
import { SearchModule } from '../search/search.module';
import { CLIAgentModule } from '../cli-agent/cli-agent.module';
import { ImageModule } from '../image/image.module';
import { SkillsModule } from '../skills/skills.module';
import { PersonaModule } from '../persona/persona.module';
import { CredentialsModule } from '../credentials/credentials.module';

describe('ToolModule', () => {
  it('stays thin and does not own cross-domain composition imports', () => {
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, ToolModule) as unknown[]) ?? [];

    expect(imports).not.toContain(VFSModule);
    expect(imports).not.toContain(LLMModule);
    expect(imports).not.toContain(RAAppModule);
    expect(imports).not.toContain(MemoryModule);
    expect(imports).not.toContain(AllowedPathsModule);
    expect(imports).not.toContain(MCPModule);
    expect(imports).not.toContain(SearchModule);
    expect(imports).not.toContain(CLIAgentModule);
    expect(imports).not.toContain(ImageModule);
    expect(imports).not.toContain(SkillsModule);
    expect(imports).not.toContain(PersonaModule);
    expect(imports).not.toContain(CredentialsModule);
  });
});