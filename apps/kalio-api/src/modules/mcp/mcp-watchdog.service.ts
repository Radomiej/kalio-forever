import { Injectable, Logger } from '@nestjs/common';
import { MCPService } from './mcp.service';

// Watchdog: monitors MCP server health, reconnects on failure.
// Full implementation: Phase 8.
@Injectable()
export class MCPWatchdogService {
  private readonly logger = new Logger(MCPWatchdogService.name);

  constructor(private readonly mcp: MCPService) {}

  // TODO Phase 8: poll server health every 30s, emit mcp:disconnected on failure
}
