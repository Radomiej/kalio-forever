import { describe, expect, it, vi } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ChatModule } from './chat.module';
import { TOOL_REGISTRY } from './chat.tokens';
import { TOOL_DISPATCH_REGISTRY } from '../tool/tool-dispatch-registry.port';
import { ToolRegistryService } from '../tool/tool-registry.service';

describe('ChatModule', () => {
  it('routes Telegram Stop through the shared coordinator and propagates required ACK failure', async () => {
    let handlers: { stopAll(): Promise<void> } | undefined;
    const stop = vi.fn(async () => { throw new Error('required ACK'); });
    const module = new ChatModule({ setCommandHandlers: (value: { stopAll(): Promise<void> }) => { handlers = value; } } as never,
      { getActiveSessionIds: () => new Set(['first', 'failed', 'last']) } as never,
      {} as never, {} as never, { stopSessionTrees: stop } as never);
    module.onModuleInit();
    await expect(handlers!.stopAll()).rejects.toThrow('required ACK');
    expect(stop).toHaveBeenCalledExactlyOnceWith(['first', 'failed', 'last']);
  });
  it('builds TOOL_REGISTRY from the dispatch port instead of ToolRegistryService', () => {
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ChatModule) as Array<Record<string, unknown>>) ?? [];
    const registryProvider = providers.find((provider) => provider.provide === TOOL_REGISTRY);

    expect(registryProvider).toBeDefined();
    expect(registryProvider?.inject).toContain(TOOL_DISPATCH_REGISTRY);
    expect(registryProvider?.inject).not.toContain(ToolRegistryService);
  });
});
