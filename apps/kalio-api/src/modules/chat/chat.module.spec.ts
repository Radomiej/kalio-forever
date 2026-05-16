import { describe, expect, it } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ChatModule } from './chat.module';
import { TOOL_REGISTRY } from './chat.tokens';
import { TOOL_DISPATCH_REGISTRY } from '../tool/tool-dispatch-registry.port';
import { ToolRegistryService } from '../tool/tool-registry.service';

describe('ChatModule', () => {
  it('builds TOOL_REGISTRY from the dispatch port instead of ToolRegistryService', () => {
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ChatModule) as Array<Record<string, unknown>>) ?? [];
    const registryProvider = providers.find((provider) => provider.provide === TOOL_REGISTRY);

    expect(registryProvider).toBeDefined();
    expect(registryProvider?.inject).toContain(TOOL_DISPATCH_REGISTRY);
    expect(registryProvider?.inject).not.toContain(ToolRegistryService);
  });
});