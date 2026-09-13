import { Module } from '@nestjs/common';
import { KalioMcpBridgeContextRegistry } from './kalio-mcp-bridge-context';

@Module({
  providers: [KalioMcpBridgeContextRegistry],
  exports: [KalioMcpBridgeContextRegistry],
})
export class KalioMcpBridgeContextModule {}
