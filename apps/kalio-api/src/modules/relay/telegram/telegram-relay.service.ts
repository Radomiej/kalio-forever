import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Bot } from 'grammy';
import { AppSettingsService } from '../../../database/app-settings.service';
import { RemoteRelayChannel } from '../remote-relay-channel.interface';
import type { RelayCommandHandlers } from '../relay-command-handlers.interface';
import { escapeMarkdownV2, splitMessage } from './telegram.utils';
import { registerTelegramCommands } from './telegram-command-registration';

const KEY_BOT_TOKEN = 'relay.telegram.bot_token';
const KEY_CHAT_ID = 'relay.telegram.chat_id';
const TELEGRAM_COMMANDS = [
  { command: 'start', description: 'Show connection status' },
  { command: 'register', description: 'Link this chat to Kalio' },
  { command: 'status', description: 'Show active sessions' },
  { command: 'stop', description: 'Stop all running sessions' },
  { command: 'approve', description: 'Approve a pending HITL request' },
  { command: 'cancel', description: 'Cancel a pending HITL request' },
  { command: 'help', description: 'Show available commands' },
] as const;

interface StartBotOptions {
  waitForPollingStart?: boolean;
}

@Injectable()
export class TelegramRelayService extends RemoteRelayChannel implements OnModuleInit, OnModuleDestroy {
  readonly id = 'telegram';
  private readonly logger = new Logger(TelegramRelayService.name);

  private bot: Bot | null = null;
  private botToken: string | null = null;
  private chatId: string | null = null;
  private botUsername: string | null = null;
  private commandHandlers: RelayCommandHandlers | null = null;

  constructor(private readonly settings: AppSettingsService) {
    super();
  }

  get isConnected(): boolean {
    return this.bot !== null;
  }

  async onModuleInit(): Promise<void> {
    const token = await this.settings.get(KEY_BOT_TOKEN);
    if (token) {
      const chatId = await this.settings.get(KEY_CHAT_ID);
      if (chatId) this.chatId = chatId;
      try {
        await this.startBot(token);
        this.botToken = token;
        if (this.botUsername) {
          this.logger.log(`Telegram bot auto-started as @${this.botUsername}`);
        }
      } catch (err) {
        this.logger.warn(
          'Failed to auto-start Telegram bot on init',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopBot();
  }

  async connect(botToken: string): Promise<{ botUsername: string }> {
    const previousConnection = this.bot && this.botToken
      ? { botToken: this.botToken, chatId: this.chatId }
      : null;

    if (this.bot) {
      await this.stopBot();
    }
    try {
      const botUsername = await this.startBot(botToken, { waitForPollingStart: true });
      this.botToken = botToken;
      await this.settings.set(KEY_BOT_TOKEN, botToken);
      return { botUsername };
    } catch (err) {
      await this.restorePreviousConnection(previousConnection);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.stopBot();
    this.botToken = null;
    await this.settings.delete(KEY_BOT_TOKEN);
    await this.settings.delete(KEY_CHAT_ID);
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.bot || !this.chatId) return;
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(this.chatId, escapeMarkdownV2(chunk), { parse_mode: 'MarkdownV2' });
    }
  }
  setCommandHandlers(handlers: RelayCommandHandlers): void {
    this.commandHandlers = handlers;
  }

  getStatus(): { connected: boolean; botUsername?: string; chatIdRegistered: boolean } {
    return {
      connected: this.isConnected,
      botUsername: this.botUsername ?? undefined,
      chatIdRegistered: this.chatId !== null,
    };
  }

  private async startBot(token: string, options: StartBotOptions = {}): Promise<string> {
    const bot = new Bot(token);
    await bot.api.deleteWebhook();
    await bot.api.setMyCommands(TELEGRAM_COMMANDS);
    const me = await bot.api.getMe();
    const waitForPollingStart = options.waitForPollingStart === true;
    let resolvePollingStart: (() => void) | null = null;
    let rejectPollingStart: ((error: Error) => void) | null = null;

    const pollingStartPromise = waitForPollingStart
      ? new Promise<void>((resolve, reject) => {
          resolvePollingStart = resolve;
          rejectPollingStart = reject;
        })
      : null;

    this.bot = bot;
    this.botUsername = me.username;
    this.registerCommands(bot);
    bot.catch((err) => {
      this.logger.error(
        'Telegram bot error',
        err.error instanceof Error ? err.error : new Error(String(err.error)),
      );
    });

    const finishPollingStart = (error?: Error): void => {
      if (error) {
        rejectPollingStart?.(error);
      } else {
        resolvePollingStart?.();
      }
      resolvePollingStart = null;
      rejectPollingStart = null;
    };

    void Promise.resolve(
      bot.start({
        onStart: () => {
          this.logger.log(`Telegram bot @${me.username} polling started`);
          finishPollingStart();
        },
      }),
    ).catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        'Telegram bot polling stopped unexpectedly',
        error,
      );
      if (this.bot === bot) {
        this.bot = null;
        this.botUsername = null;
      }
      finishPollingStart(error);
    });

    if (pollingStartPromise) {
      await pollingStartPromise;
    }

    return me.username;
  }

  private async stopBot(): Promise<void> {
    if (this.bot) {
      try {
        await this.bot.stop();
      } catch (err) {
        this.logger.warn(
          'Error stopping Telegram bot',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      this.bot = null;
      this.chatId = null;
      this.botUsername = null;
    }
  }

  private async restorePreviousConnection(previousConnection: { botToken: string; chatId: string | null } | null): Promise<void> {
    if (!previousConnection) {
      return;
    }
    try {
      await this.startBot(previousConnection.botToken, { waitForPollingStart: true });
      this.botToken = previousConnection.botToken;
      this.chatId = previousConnection.chatId;
    } catch (restoreErr) {
      this.logger.warn(
        'Failed to restore previous Telegram bot after connect error',
        restoreErr instanceof Error ? restoreErr : new Error(String(restoreErr)),
      );
    }
  }

  private registerCommands(bot: Bot): void {
    registerTelegramCommands(bot, {
      getChatId: () => this.chatId,
      persistChatId: (chatId) => this.persistChatId(chatId),
      getCommandHandlers: () => this.commandHandlers,
      logger: this.logger,
    });
  }

  private async persistChatId(chatId: string): Promise<void> {
    this.chatId = chatId;
    await this.settings.set(KEY_CHAT_ID, chatId);
    this.logger.log(`Telegram chat registered: ${chatId}`);
  }
}
