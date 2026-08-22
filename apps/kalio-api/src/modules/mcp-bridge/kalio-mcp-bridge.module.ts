import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { KalioMcpBridgeController } from './kalio-mcp-bridge.controller';
import { KalioMcpBridgeService } from './kalio-mcp-bridge.service';

@Module({
  imports: [ChatModule],
  controllers: [KalioMcpBridgeController],
  providers: [KalioMcpBridgeService],
})
export class KalioMcpBridgeModule {}
