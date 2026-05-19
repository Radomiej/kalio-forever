import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RelayService } from './relay.service';
import { TelegramRelayService } from './telegram/telegram-relay.service';

describe('RelayService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when no relay channel is connected', async () => {
    const telegram = {
      id: 'telegram',
      isConnected: false,
      sendMessage: vi.fn(async () => undefined),
    };
    const service = new RelayService(telegram as unknown as TelegramRelayService);

    await expect(service.broadcast('hello')).resolves.toBe(false);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('broadcasts to connected relay channels', async () => {
    const telegram = {
      id: 'telegram',
      isConnected: true,
      sendMessage: vi.fn(async () => undefined),
    };
    const service = new RelayService(telegram as unknown as TelegramRelayService);

    await expect(service.broadcast('hello')).resolves.toBe(true);
    expect(telegram.sendMessage).toHaveBeenCalledWith('hello');
  });

  it('logs channel failures without aborting the broadcast', async () => {
    const error = new Error('boom');
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const telegram = {
      id: 'telegram',
      isConnected: true,
      sendMessage: vi.fn(async () => {
        throw error;
      }),
    };
    const service = new RelayService(telegram as unknown as TelegramRelayService);

    await expect(service.broadcast('hello')).resolves.toBe(true);
    expect(errorSpy).toHaveBeenCalledWith('[RelayService] Channel telegram failed to send message', error);
  });

  it('returns only connected channels', () => {
    const telegram = {
      id: 'telegram',
      isConnected: true,
      sendMessage: vi.fn(async () => undefined),
    };
    const service = new RelayService(telegram as unknown as TelegramRelayService);

    expect(service.getConnected()).toStrictEqual([telegram]);
  });
});