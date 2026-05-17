import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Bot } from 'grammy';
import { AppSettingsService } from '../../../database/app-settings.service';
import { RemoteRelayChannel } from '../remote-relay-channel.interface';
import type { RelayCommandHandlers } from '../relay-command-handlers.interface';
import { escapeMarkdownV2, splitMessage } from './telegram.utils';

const KEY_BOT_TOKEN = 'relay.telegram.bot_token';
const KEY_CHAT_ID = 'relay.telegram.chat_id';

@Injectable()
export class TelegramRelayService extends RemoteRelayChannel implements OnModuleInit, OnModuleDestroy {
  readonly id = 'telegram';
  private readonly logger = new Logger(TelegramRelayService.name);

  private bot: Bot | null = null;
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
        this.logger.log(`Telegram bot auto-started as @${this.botUsername}`);
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
    if (this.bot) {
      await this.stopBot();
    }
    await this.startBot(botToken);
    await this.settings.set(KEY_BOT_TOKEN, botToken);
    return { botUsername: this.botUsername! };
  }

  async disconnect(): Promise<void> {
    await this.stopBot();
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

  private async startBot(token: string): Promise<void> {
    const bot = new Bot(token);
    const me = await bot.api.getMe();
    this.bot = bot;
    this.botUsername = me.username;
    this.registerCommands(bot);
    bot.catch((err) => {
      this.logger.error(
        'Telegram bot error',
        err.error instanceof Error ? err.error : new Error(String(err.error)),
      );
    });
    void bot.start({ onStart: () => this.logger.log(`Telegram bot @${me.username} polling started`) });
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

  private registerCommands(bot: Bot): void {
    bot.command('start', async (ctx) => {
      if (!this.chatId) {
        await ctx.reply(
          'Welcome to Kalio\! Send /register to link this chat and receive notifications\.',
          { parse_mode: 'MarkdownV2' },
        );
      } else {
        await ctx.reply('Kalio is connected\. Use /help to see available commands\.', {
          parse_mode: 'MarkdownV2',
        });
      }
    });

    bot.command('register', async (ctx) => {
      const newChatId = String(ctx.chat.id);
      this.chatId = newChatId;
      await this.settings.set(KEY_CHAT_ID, newChatId).catch((err: unknown) => {
        this.logger.error(
          'Failed to persist chat_id',
          err instanceof Error ? err : new Error(String(err)),
        );
      });
      this.logger.log(`Telegram chat registered: ${newChatId}`);
      await ctx.reply(
        'Registered\! Kalio notifications will be sent to this chat\.',
        { parse_mode: 'MarkdownV2' },
      );
    });

    bot.command('help', async (ctx) => {
      await ctx.reply(
        '/register \- Link this chat to receive notifications\n' +
          '/status \- Show active sessions\n' +
          '/stop \- Stop all running sessions\n' +
          '/help \- Show this message',
        { parse_mode: 'MarkdownV2' },
      );
    });


    bot.command('status', async (ctx) => {
      if (!this.commandHandlers) {
        await ctx.reply('Status not available yet.');
        return;
      }
      try {
        const status = await this.commandHandlers.getStatus();
        await ctx.reply(escapeMarkdownV2(status), { parse_mode: 'MarkdownV2' });
      } catch (err) {
        this.logger.error(
          'Error handling /status command',
          err instanceof Error ? err : new Error(String(err)),
        );
        await ctx.reply('Error retrieving status.');
      }
    });

    bot.command('stop', async (ctx) => {
      if (!this.commandHandlers) {
        await ctx.reply('Stop not available yet.');
        return;
      }
      try {
        await this.commandHandlers.stopAll();
        await ctx.reply('All sessions stopped\\.');
      } catch (err) {
        this.logger.error(
          'Error handling /stop command',
          err instanceof Error ? err : new Error(String(err)),
        );
        await ctx.reply('Error stopping sessions.');
      }
    });

    // Fallback: only fires for non-command messages (all commands above already consumed their routes)
    bot.on('message', async (ctx) => {
      if (!this.chatId) {
        await ctx.reply(
          'Send /register to link this chat to your Kalio instance\\.',
          { parse_mode: 'MarkdownV2' },
        );
      }
    });
  }
}
