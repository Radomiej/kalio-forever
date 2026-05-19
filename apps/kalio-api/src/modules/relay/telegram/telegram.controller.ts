import { Body, Controller, Delete, Get, HttpCode, HttpStatus, BadRequestException, Post } from '@nestjs/common';
import { TelegramRelayService } from './telegram-relay.service';

interface ConnectBody {
  botToken: string;
}

@Controller('relay/telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramRelayService) {}

  @Get('status')
  getStatus(): { connected: boolean; botUsername?: string; chatIdRegistered: boolean } {
    return this.telegram.getStatus();
  }

  @Post('connect')
  async connect(@Body() body: ConnectBody): Promise<{ botUsername: string }> {
    if (!body.botToken || typeof body.botToken !== 'string') {
      throw new BadRequestException('botToken is required');
    }
    return this.telegram.connect(body.botToken);
  }

  @Delete('connect')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(): Promise<void> {
    await this.telegram.disconnect();
  }
}
