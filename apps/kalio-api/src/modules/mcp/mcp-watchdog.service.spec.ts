import { describe, expect, it } from 'vitest';
import { MCPWatchdogService } from './mcp-watchdog.service';
import { MCPService } from './mcp.service';

describe('MCPWatchdogService', () => {
  it('is constructible', () => {
    const service = new MCPWatchdogService({} as MCPService);

    expect(service).toBeInstanceOf(MCPWatchdogService);
  });
});