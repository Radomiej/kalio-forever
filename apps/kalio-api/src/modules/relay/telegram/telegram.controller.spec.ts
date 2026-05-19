import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramController } from './telegram.controller';
import { TelegramRelayService } from './telegram-relay.service';

describe('TelegramController', () => {
  const telegram = {
    connect: vi.fn(async (_token: string) => ({ botUsername: 'kalio_bot' })),
    disconnect: vi.fn(async () => undefined),
    getStatus: vi.fn(() => ({ connected: true, botUsername: 'kalio_bot', chatIdRegistered: true })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns relay status from the telegram service', () => {
    const controller = new TelegramController(telegram as unknown as TelegramRelayService);

    expect(controller.getStatus()).toStrictEqual({
      connected: true,
      botUsername: 'kalio_bot',
      chatIdRegistered: true,
    });
  });

  it('rejects missing bot tokens', async () => {
    const controller = new TelegramController(telegram as unknown as TelegramRelayService);

    await expect(controller.connect({ botToken: '' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('connects and disconnects through the relay service', async () => {
    const controller = new TelegramController(telegram as unknown as TelegramRelayService);

    await expect(controller.connect({ botToken: 'secret-token' })).resolves.toStrictEqual({
      botUsername: 'kalio_bot',
    });
    await expect(controller.disconnect()).resolves.toBeUndefined();
    expect(telegram.connect).toHaveBeenCalledWith('secret-token');
    expect(telegram.disconnect).toHaveBeenCalledOnce();
  });
});