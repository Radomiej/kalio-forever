import { describe, expect, it, vi } from 'vitest';
import { RemoteRelayChannel } from './remote-relay-channel.interface';

class TestRelayChannel extends RemoteRelayChannel {
  readonly id = 'test';

  get isConnected(): boolean {
    return true;
  }

  readonly sendMessage = vi.fn(async (_text: string) => undefined);
}

describe('RemoteRelayChannel', () => {
  it('provides a runtime contract for relay channel implementations', async () => {
    const channel = new TestRelayChannel();

    expect(channel.id).toBe('test');
    expect(channel.isConnected).toBe(true);
    await expect(channel.sendMessage('hello')).resolves.toBeUndefined();
  });
});