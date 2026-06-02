import { Module } from '@nestjs/common';
import { TelegramRelayService } from './telegram/telegram-relay.service';
import { TelegramController } from './telegram/telegram.controller';
import { RelayService } from './relay.service';

@Module({
  providers: [TelegramRelayService, RelayService],
  controllers: [TelegramController],
  exports: [RelayService, TelegramRelayService],
})
export class RelayModule {}
