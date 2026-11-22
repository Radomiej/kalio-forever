import { describe, it, expect, vi } from 'vitest';
import { CodexImageGenerationService } from './codex-image-generation.service';
import type { CodexAppServerConnection, CodexServerNotification } from './codex-app-server.host';
import { CodexAppServerHost } from './codex-app-server.host';
import { ExecutionProfileService } from './execution-profile.service';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
function setup(accountType: string | null = 'chatgpt', result = png) {
  const listeners = new Set<(event: CodexServerNotification) => void>();
  const emit = (method: string, params: unknown) => listeners.forEach(fn => fn({ method, params }));
  const rpc = vi.fn(async (method: string) => {
    if (method === 'account/read') return { account: accountType ? { type: accountType } : null };
    if (method === 'thread/start') return { thread: { id: 'image-thread' } };
    if (method === 'turn/start') {
      emit('item/completed', { threadId: 'image-thread', turnId: 'image-turn', item: { type: 'imageGeneration', status: 'completed', result, savedPath: '/never/read/this.png' } });
      emit('turn/completed', { threadId: 'image-thread', turn: { id: 'image-turn', status: 'completed' } });
      return { turn: { id: 'image-turn' } };
    }
    return {};
  });
  const connection: CodexAppServerConnection = { processEpoch: 'epoch', request: rpc, notify: vi.fn(), respond: vi.fn(), close: vi.fn(),
    onNotification: fn => { listeners.add(fn); return () => listeners.delete(fn); }, onRequest: () => vi.fn() };
  const host = { getConnection: vi.fn().mockResolvedValue(connection), registerThread: vi.fn(), unregisterThread: vi.fn() };
  const profiles = { assertEnabled: vi.fn().mockResolvedValue({ id: 'profile', kind: 'codex-app-server', model: 'gpt-5.4', authProfileId: 'chatgpt-default' }) };
  return { rpc, host, profiles, service: new CodexImageGenerationService(host as unknown as CodexAppServerHost, profiles as unknown as ExecutionProfileService) };
}
const request = { executionProfileId: 'profile', prompt: 'edit the image', size: '1024x1024', quality: 'high' as const, outputFormat: 'webp' as const };
describe('Native ChatGPT image generation adapter', () => {
  it('reuses profile login, creates an ephemeral thread, and reports decoded dimensions and requested format', async () => {
    const f = setup();
    const result = await f.service.generate(request);
    expect(result).toMatchObject({ width: 1, height: 1, format: 'webp', mimeType: 'image/webp', model: 'gpt-5.4' });
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(f.host.getConnection).toHaveBeenCalledWith('chatgpt-default', 'read-only');
    expect(f.rpc).toHaveBeenCalledWith('thread/start', expect.objectContaining({ ephemeral: true, dynamicTools: [], approvalPolicy: 'never' }));
    expect(f.rpc).toHaveBeenCalledWith('thread/unsubscribe', { threadId: 'image-thread' });
    expect(f.host.unregisterThread).toHaveBeenCalledWith('chatgpt-default', 'image-thread');
  });

  it.each([null, 'apiKey'])('rejects %s login without starting an inference turn', async type => {
    const f = setup(type);
    await expect(f.service.generate(request)).rejects.toThrow('Sign in with ChatGPT');
    expect(f.rpc).not.toHaveBeenCalledWith('thread/start', expect.anything());
  });

  it('rejects another kind of agent', async () => {
    const f = setup(); f.profiles.assertEnabled.mockResolvedValue({ id: 'profile', kind: 'claude-agent-sdk' });
    await expect(f.service.generate(request)).rejects.toThrow('enabled ChatGPT');
    expect(f.host.getConnection).not.toHaveBeenCalled();
  });

  it('rejects malformed image data and still unloads the thread', async () => {
    const f = setup('chatgpt', 'not-image!');
    await expect(f.service.generate(request)).rejects.toThrow('invalid');
    expect(f.host.unregisterThread).toHaveBeenCalled();
  });
});
