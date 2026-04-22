import { test } from '@playwright/test';

// AC-15: When MCP server goes down, watchdog marks it as error and emits mcp:error
test.describe('AC-15: MCP watchdog error recovery', () => {
  test.skip('watchdog detects disconnected MCP server and marks status as error', () => {});
  test.skip('mcp:error event is emitted to connected WebSocket clients', () => {});
  test.skip('MCP panel shows error status for disconnected server', () => {});
});
