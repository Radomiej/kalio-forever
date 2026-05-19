import { describe, expect, it } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { DatabaseModule } from './database/database.module';
import { LLMModule } from './modules/llm/llm.module';
import { PersonaModule } from './modules/persona/persona.module';
import { ToolModule } from './modules/tool/tool.module';
import { VFSModule } from './modules/vfs/vfs.module';
import { MCPModule } from './modules/mcp/mcp.module';
import { RAAppModule } from './modules/raapp/raapp.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { SkillsModule } from './modules/skills/skills.module';
import { MemoryModule } from './modules/memory/memory.module';
import { AllowedPathsModule } from './modules/allowed-paths/allowed-paths.module';
import { ChatModule } from './modules/chat/chat.module';
import { SearchModule } from './modules/search/search.module';
import { CLIAgentModule } from './modules/cli-agent/cli-agent.module';
import { ImageModule } from './modules/image/image.module';
import { RelayModule } from './modules/relay/relay.module';
import { HitlModule } from './modules/hitl/hitl.module';

describe('AppModule', () => {
  it('registers the full application module graph', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = '/tmp/kalio-app-module.db';
    process.env.WORKSPACE_ROOT = '/tmp/kalio-app-module-workspace';

    const { AppModule } = await import('./app.module');
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[]) ?? [];

    expect(imports[0]).toBeDefined();
    expect(imports).toContain(DatabaseModule);
    expect(imports).toContain(LLMModule);
    expect(imports).toContain(PersonaModule);
    expect(imports).toContain(CredentialsModule);
    expect(imports).toContain(VFSModule);
    expect(imports).toContain(ToolModule);
    expect(imports).toContain(MCPModule);
    expect(imports).toContain(RAAppModule);
    expect(imports).toContain(SkillsModule);
    expect(imports).toContain(AllowedPathsModule);
    expect(imports).toContain(MemoryModule);
    expect(imports).toContain(ChatModule);
    expect(imports).toContain(SearchModule);
    expect(imports).toContain(CLIAgentModule);
    expect(imports).toContain(ImageModule);
    expect(imports).toContain(HitlModule);
    expect(imports).toContain(RelayModule);
  });
});
