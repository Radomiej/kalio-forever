import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ChatModule } from '../chat/chat.module';
import { KalioMcpBridgeController } from './kalio-mcp-bridge.controller';
import { KalioMcpBridgeService } from './kalio-mcp-bridge.service';
import { KalioMcpBridgeContextModule } from '../../common/kalio-mcp-bridge-context.module';

@Module({
  imports: [DatabaseModule, ChatModule, KalioMcpBridgeContextModule],
  controllers: [KalioMcpBridgeController],
  providers: [KalioMcpBridgeService],
})
export class KalioMcpBridgeModule {}
