import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramRelayService } from './telegram-relay.service';

const grammyMock = vi.hoisted(() => {
  const api = {
    deleteWebhook: vi.fn(async () => undefined),
    getMe: vi.fn(async () => ({ username: 'kalio_test_bot' })),
    sendMessage: vi.fn(async () => undefined),
    setMyCommands: vi.fn(async () => true),
  };

  const start = vi.fn(() => undefined);
  const stop = vi.fn(async () => undefined);
  const catchHandler = vi.fn(() => undefined);
  const command = vi.fn(() => undefined);
  const on = vi.fn(() => undefined);

  return { api, start, stop, catchHandler, command, on };
});

vi.mock('grammy', () => {
  class Bot {
    readonly api = grammyMock.api;
    readonly token: string;

    constructor(token: string) {
      this.token = token;
    }

    readonly start = grammyMock.start;
    readonly stop = grammyMock.stop;
    readonly catch = grammyMock.catchHandler;
    readonly command = grammyMock.command;
    readonly on = grammyMock.on;
  }

  return { Bot };
});

describe('TelegramRelayService', () => {
  type ReplyFn = (text: string, options?: { parse_mode: 'MarkdownV2' }) => Promise<void>;
  type TextContext = { chat: { id: number }; reply: ReplyFn };
  type CommandContext = { chat: { id: number }; reply: ReplyFn };

  const settings = {
    delete: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    settings.get.mockResolvedValue(null);
    grammyMock.api.getMe.mockResolvedValue({ username: 'kalio_test_bot' });
  });

  it('cleans up webhook state and publishes command metadata before polling starts', async () => {
    const service = new TelegramRelayService(settings as never);

    await service.connect('test-token');

    expect(grammyMock.api.deleteWebhook).toHaveBeenCalledOnce();
    expect(grammyMock.api.setMyCommands).toHaveBeenCalledWith([
      { command: 'start', description: 'Show connection status' },
      { command: 'register', description: 'Link this chat to Kalio' },
      { command: 'status', description: 'Show active sessions' },
      { command: 'stop', description: 'Stop all running sessions' },
      { command: 'help', description: 'Show available commands' },
    ]);
    expect(grammyMock.start).toHaveBeenCalledOnce();
    expect(grammyMock.api.deleteWebhook.mock.invocationCallOrder[0]).toBeLessThan(
      grammyMock.start.mock.invocationCallOrder[0],
    );
    expect(grammyMock.api.setMyCommands.mock.invocationCallOrder[0]).toBeLessThan(
      grammyMock.start.mock.invocationCallOrder[0],
    );
  });

  it('auto-registers the first inbound text chat and listens to both direct messages and channel posts', async () => {
    const service = new TelegramRelayService(settings as never);

    await service.connect('test-token');

    const onCalls = grammyMock.on.mock.calls as unknown as Array<[string, unknown]>;
    const messageHandler = onCalls.find((call) => call[0] === 'message:text')?.[1] as
      | ((ctx: TextContext) => Promise<void>)
      | undefined;
    const channelHandler = onCalls.find((call) => call[0] === 'channel_post:text')?.[1];

    expect(messageHandler).toBeDefined();
    expect(channelHandler).toBeDefined();

    const reply = vi.fn(async () => undefined);

    await messageHandler!({ chat: { id: 42 }, reply });

    expect(settings.set).toHaveBeenCalledWith('relay.telegram.chat_id', '42');
    expect(reply).toHaveBeenCalledWith(
      'Registered\\! Kalio notifications will be sent to this chat\\.',
      { parse_mode: 'MarkdownV2' },
    );
  });

  it('reports status, sends escaped messages, and clears persisted state on disconnect', async () => {
    const service = new TelegramRelayService(settings as never);

    await service.connect('test-token');

    const onCalls = grammyMock.on.mock.calls as unknown as Array<[string, unknown]>;
    const messageHandler = onCalls.find((call) => call[0] === 'message:text')?.[1] as
      | ((ctx: TextContext) => Promise<void>)
      | undefined;

    expect(service.getStatus()).toStrictEqual({
      connected: true,
      botUsername: 'kalio_test_bot',
      chatIdRegistered: false,
    });

    const reply = vi.fn(async () => undefined);
    await messageHandler!({ chat: { id: 42 }, reply });

    expect(service.getStatus()).toStrictEqual({
      connected: true,
      botUsername: 'kalio_test_bot',
      chatIdRegistered: true,
    });

    await service.sendMessage('Hello *world*');

    expect(grammyMock.api.sendMessage).toHaveBeenCalledWith('42', 'Hello \\*world\\*', {
      parse_mode: 'MarkdownV2',
    });

    await service.disconnect();

    expect(grammyMock.stop).toHaveBeenCalledOnce();
    expect(settings.delete).toHaveBeenNthCalledWith(1, 'relay.telegram.bot_token');
    expect(settings.delete).toHaveBeenNthCalledWith(2, 'relay.telegram.chat_id');
    expect(service.getStatus()).toStrictEqual({
      connected: false,
      botUsername: undefined,
      chatIdRegistered: false,
    });
  });

  it('executes registered telegram command callbacks', async () => {
    const service = new TelegramRelayService(settings as never);
    const reply = vi.fn(async () => undefined);
    const commandHandlers = {
      getStatus: vi.fn(async () => 'All systems nominal'),
      stopAll: vi.fn(async () => undefined),
    };

    await service.connect('test-token');
    service.setCommandHandlers(commandHandlers);

    const commandCalls = grammyMock.command.mock.calls as unknown as Array<[string, unknown]>;
    const startHandler = commandCalls.find((call) => call[0] === 'start')?.[1] as
      | ((ctx: CommandContext) => Promise<void>)
      | undefined;
    const registerHandler = commandCalls.find((call) => call[0] === 'register')?.[1] as
      | ((ctx: CommandContext) => Promise<void>)
      | undefined;
    const helpHandler = commandCalls.find((call) => call[0] === 'help')?.[1] as
      | ((ctx: CommandContext) => Promise<void>)
      | undefined;
    const statusHandler = commandCalls.find((call) => call[0] === 'status')?.[1] as
      | ((ctx: CommandContext) => Promise<void>)
      | undefined;
    const stopHandler = commandCalls.find((call) => call[0] === 'stop')?.[1] as
      | ((ctx: CommandContext) => Promise<void>)
      | undefined;

    await startHandler!({ chat: { id: 42 }, reply });
    await registerHandler!({ chat: { id: 42 }, reply });
    await helpHandler!({ chat: { id: 42 }, reply });
    await statusHandler!({ chat: { id: 42 }, reply });
    await stopHandler!({ chat: { id: 42 }, reply });

    expect(settings.set).toHaveBeenCalledWith('relay.telegram.chat_id', '42');
    expect(commandHandlers.getStatus).toHaveBeenCalledOnce();
    expect(commandHandlers.stopAll).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('/register'),
      { parse_mode: 'MarkdownV2' },
    );
    expect(reply).toHaveBeenCalledWith(
      'Registered\\! Kalio notifications will be sent to this chat\\.',
      { parse_mode: 'MarkdownV2' },
    );
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('/status'),
      { parse_mode: 'MarkdownV2' },
    );
    expect(reply).toHaveBeenCalledWith('All systems nominal', { parse_mode: 'MarkdownV2' });
    expect(reply).toHaveBeenCalledWith('All sessions stopped\\.');
  });
});
