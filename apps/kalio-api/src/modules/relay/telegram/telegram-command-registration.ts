import type { Logger } from '@nestjs/common';
import type { Bot } from 'grammy';
import type { RelayCommandHandlers } from '../relay-command-handlers.interface';
import { escapeMarkdownV2 } from './telegram.utils';

type TelegramTextContext = {
  chat: { id: number };
  match?: string | RegExpMatchArray;
  message?: { text?: string };
  channelPost?: { text?: string };
  reply: (text: string, extra?: { parse_mode: 'MarkdownV2' }) => Promise<unknown>;
};

interface TelegramCommandRegistrationOptions {
  getChatId: () => string | null;
  persistChatId: (chatId: string) => Promise<void>;
  getCommandHandlers: () => RelayCommandHandlers | null;
  logger: Pick<Logger, 'error'>;
}

export function registerTelegramCommands(bot: Bot, options: TelegramCommandRegistrationOptions): void {
  bot.command('start', async (ctx) => {
    if (!options.getChatId()) {
      await ctx.reply(
        'Welcome to Kalio\\! Send any message or /register to link this chat and receive notifications\\.',
        { parse_mode: 'MarkdownV2' },
      );
    } else {
      await ctx.reply('Kalio is connected\\. Use /help to see available commands\\.', {
        parse_mode: 'MarkdownV2',
      });
    }
  });

  bot.command('register', async (ctx) => {
    try {
      await options.persistChatId(String(ctx.chat.id));
      await ctx.reply('Registered\\! Kalio notifications will be sent to this chat\\.', { parse_mode: 'MarkdownV2' });
    } catch (err) {
      options.logger.error('Failed to register Telegram chat', err instanceof Error ? err : new Error(String(err)));
      await ctx.reply('Failed to register this chat\\. Try again in a moment\\.', { parse_mode: 'MarkdownV2' });
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'Send any message to auto-register this chat\n\n' +
        '/register - Link this chat to receive notifications\n' +
        '/status - Show active sessions\n' +
        '/stop - Stop all running sessions\n' +
        '/approve <requestId> [reason] - Approve a HITL request\n' +
        '/cancel <requestId> [reason] - Cancel a HITL request\n' +
        '/help - Show this message',
      { parse_mode: 'MarkdownV2' },
    );
  });

  bot.command('status', async (ctx) => {
    const commandHandlers = options.getCommandHandlers();
    if (!commandHandlers) {
      await ctx.reply('Status not available yet.');
      return;
    }
    try {
      const status = await commandHandlers.getStatus();
      await ctx.reply(escapeMarkdownV2(status), { parse_mode: 'MarkdownV2' });
    } catch (err) {
      options.logger.error('Error handling /status command', err instanceof Error ? err : new Error(String(err)));
      await ctx.reply('Error retrieving status.');
    }
  });

  bot.command('stop', async (ctx) => {
    const commandHandlers = options.getCommandHandlers();
    if (!commandHandlers) {
      await ctx.reply('Stop not available yet.');
      return;
    }
    try {
      await commandHandlers.stopAll();
      await ctx.reply('All sessions stopped\\.');
    } catch (err) {
      options.logger.error('Error handling /stop command', err instanceof Error ? err : new Error(String(err)));
      await ctx.reply('Error stopping sessions.');
    }
  });

  bot.command('approve', async (ctx) => {
    await handleApprovalCommand(ctx, 'approve', options);
  });

  bot.command('cancel', async (ctx) => {
    await handleApprovalCommand(ctx, 'cancel', options);
  });

  const handleTextContact = async (ctx: TelegramTextContext) => {
    const incomingChatId = String(ctx.chat.id);
    const chatId = options.getChatId();

    if (!chatId) {
      await options.persistChatId(incomingChatId);
      await ctx.reply('Registered\\! Kalio notifications will be sent to this chat\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    if (chatId === incomingChatId) {
      const text = textFromContext(ctx);
      const commandHandlers = options.getCommandHandlers();
      if (text && commandHandlers?.handleApprovalReply) {
        try {
          const response = await commandHandlers.handleApprovalReply(text);
          if (response) {
            await ctx.reply(escapeMarkdownV2(response), { parse_mode: 'MarkdownV2' });
            return;
          }
        } catch (err) {
          options.logger.error(
            'Error handling Telegram approval reply',
            err instanceof Error ? err : new Error(String(err)),
          );
          await ctx.reply('Error handling approval reply\\.', { parse_mode: 'MarkdownV2' });
          return;
        }
      }
      await ctx.reply('Kalio is connected\\. Use /status, /stop or /help\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    await ctx.reply('This bot is already linked to another chat\\. Send /register here if you want to move it\\.', {
      parse_mode: 'MarkdownV2',
    });
  };

  bot.on('message:text', handleTextContact);
  bot.on('channel_post:text', handleTextContact);
}

async function handleApprovalCommand(
  ctx: TelegramTextContext,
  decision: 'approve' | 'cancel',
  options: TelegramCommandRegistrationOptions,
): Promise<void> {
  const commandHandlers = options.getCommandHandlers();
  if (!commandHandlers) {
    await ctx.reply('Approval commands are not available yet\\.', { parse_mode: 'MarkdownV2' });
    return;
  }

  if (options.getChatId() !== String(ctx.chat.id)) {
    await ctx.reply('This chat is not registered for Kalio approvals\\.', { parse_mode: 'MarkdownV2' });
    return;
  }

  const matchText = typeof ctx.match === 'string' ? ctx.match : ctx.match?.[0];
  const parsed = parseCommandArgs(matchText ?? textFromContext(ctx)?.replace(/^\/(?:approve|cancel)(?:@\S+)?\s*/i, '') ?? '');
  if (!parsed.requestId) {
    await ctx.reply(`Usage: /${decision} <requestId> [reason]`, { parse_mode: 'MarkdownV2' });
    return;
  }

  try {
    const response = decision === 'approve'
      ? await commandHandlers.approveToolConfirmation(parsed.requestId, parsed.reason)
      : await commandHandlers.cancelToolConfirmation(parsed.requestId, parsed.reason);
    await ctx.reply(escapeMarkdownV2(response), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    options.logger.error(`Error handling /${decision} command`, err instanceof Error ? err : new Error(String(err)));
    await ctx.reply(`Error handling /${decision}\\.`, { parse_mode: 'MarkdownV2' });
  }
}

function parseCommandArgs(input: string): { requestId: string | null; reason?: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { requestId: null };
  }
  const [requestId, ...reasonParts] = trimmed.split(/\s+/);
  const reason = reasonParts.join(' ').trim();
  return {
    requestId,
    ...(reason ? { reason } : {}),
  };
}

function textFromContext(ctx: { message?: { text?: string }; channelPost?: { text?: string } }): string | null {
  return ctx.message?.text ?? ctx.channelPost?.text ?? null;
}
