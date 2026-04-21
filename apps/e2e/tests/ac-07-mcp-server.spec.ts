import { test } from '@playwright/test';

// AC-07: MCP server — user can add a server and see its tools listed
test.describe('AC-07: MCP server management', () => {
  test.skip(true, 'user can add an MCP server by URL and name');
  test.skip(true, 'added server appears in MCP panel with status');
  test.skip(true, 'MCP tools are listed when server is connected');
});
